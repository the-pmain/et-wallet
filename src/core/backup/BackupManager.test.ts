import { beforeEach, describe, expect, it } from 'vitest'

import { AccountManager } from '@/core/account'
import { SecretBuffer, SecureStorage } from '@/core/encryption'
import {
  AccountNotFoundError,
  ExportNotPermittedError,
  InvalidPasswordError,
  MNEMONIC_INVALID_REASON,
} from '@/core/errors'
import { HDWalletService } from '@/core/hdwallet'
import { MnemonicService } from '@/core/mnemonic'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
} from '@/core/security'
import { STORAGE_NAMESPACE, VAULT_KEY } from '@/core/storage'
import type { AccountId } from '@/core/types'
import {
  FakeClock,
  FastEncryptionService,
  InMemoryStorageService,
  NullLogger,
} from '@/test/doubles'

import { BackupManager } from './BackupManager'

const PASSWORD = 'правильный-пароль-1234'
const WRONG_PASSWORD = 'неправильный-пароль-9999'

/**
 * Тестовая фраза нулевой энтропии.
 *
 * Совпадает с общеотраслевым вектором. Записана здесь не по памяти:
 * тест ниже сверяет её с фразой, построенной из шестнадцати нулевых
 * байтов, — расхождение означало бы, что константа испорчена.
 */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Приватный ключ, равный единице. Его адрес общеизвестен. */
const IMPORTED_KEY = new Uint8Array(32)
IMPORTED_KEY[31] = 1

let storage: InMemoryStorageService
let secure: SecureStorage
let hdWallet: HDWalletService
let clock: FakeClock
let auditLog: ExportAuditLog
let guard: ExportGuard
let accounts: AccountManager
let backup: BackupManager

const mnemonicService = new MnemonicService()

/** Читает выданный секрет строкой и затирает буфер. */
function readAndWipe(secret: { bytes: Uint8Array; wipe: () => void }): string {
  const text = new TextDecoder().decode(secret.bytes)

  secret.wipe()

  return text
}

beforeEach(async () => {
  storage = new InMemoryStorageService()
  secure = new SecureStorage(storage, new FastEncryptionService())
  await secure.initialize(PASSWORD)
  await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY.Mnemonic, TEST_MNEMONIC)

  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)
  const seed = await mnemonicService.toSeed(mnemonic)
  mnemonic.wipe()

  hdWallet = HDWalletService.fromSeed(seed)
  seed.wipe()

  clock = new FakeClock(1_700_000_000_000)
  auditLog = new ExportAuditLog(storage)
  guard = new ExportGuard(auditLog, clock)

  accounts = AccountManager.create({
    hdWallet,
    secureStorage: secure,
    clock,
    logger: new NullLogger(),
  })
  await accounts.init()
  await accounts.create()

  backup = new BackupManager({
    secureStorage: secure,
    mnemonicService,
    exportGuard: guard,
    accounts,
    hdWallet,
    logger: new NullLogger(),
  })
})

describe('BackupManager: оценка риска', () => {
  it('выдачу seed-фразы оценивает как критическую', async () => {
    const assessment = await backup.assessMnemonicExport()

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })

  it('область seed-фразы не совпадает с областью аккаунта', async () => {
    /* Фраза выводит все аккаунты, включая ещё не созданные. Записав её
       выдачу под путём подписывающего аккаунта, журнал утверждал бы,
       что риск ограничен этим аккаунтом. */
    const assessment = await backup.assessMnemonicExport()

    expect(assessment.request.scope).toBe(WALLET_SCOPE)
    expect(assessment.request.scope).not.toBe(hdAccountScope(hdWallet.accountPath))
  })

  it('выдачу приватного ключа без истории оценивает как повышенный риск', async () => {
    const id = firstAccountId()

    await expect(backup.assessPrivateKeyExport(id)).resolves.toMatchObject({
      risk: EXPORT_RISK.Elevated,
    })
  })

  it('после выдачи xpub оценивает выдачу ключа как компрометацию аккаунта', async () => {
    await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, hdAccountScope(hdWallet.accountPath)),
      EXPORT_RISK.Elevated,
    )

    const assessment = await backup.assessPrivateKeyExport(firstAccountId())

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
    expect(assessment.closesCompromisePair).toBe(true)
  })

  it('отказывает в оценке для несуществующего аккаунта', async () => {
    await expect(backup.assessPrivateKeyExport('нет-такого' as AccountId)).rejects.toThrow(
      AccountNotFoundError,
    )
  })
})

describe('BackupManager: выдача seed-фразы', () => {
  it('возвращает сохранённую фразу', async () => {
    const secret = await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)

    expect(readAndWipe(secret)).toBe(TEST_MNEMONIC)
  })

  it('отвергает неверный пароль', async () => {
    await expect(backup.exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical)).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('неверный пароль не оставляет записи в журнале экспортов', async () => {
    /* Журнал, полный несостоявшихся выгрузок, завышал бы оценку риска
       последующих операций — то есть учил бы не читать предупреждения. */
    await expect(backup.exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical)).rejects.toThrow(
      InvalidPasswordError,
    )

    await expect(auditLog.hasExported(WALLET_SCOPE, EXPORT_KIND.Mnemonic)).resolves.toBe(false)
  })

  it('отказывает, если показанный уровень риска ниже фактического', async () => {
    await expect(backup.exportMnemonic(PASSWORD, EXPORT_RISK.Elevated)).rejects.toThrow(
      ExportNotPermittedError,
    )
  })

  it('записывает состоявшуюся выдачу в журнал', async () => {
    ;(await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)).wipe()

    await expect(auditLog.hasExported(WALLET_SCOPE, EXPORT_KIND.Mnemonic)).resolves.toBe(true)
  })

  it('фраза не появляется в сыром хранилище открытым текстом', async () => {
    ;(await backup.exportMnemonic(PASSWORD, EXPORT_RISK.Critical)).wipe()

    const raw = await storage.get<Record<string, unknown>>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    expect(JSON.stringify(raw)).not.toContain('abandon')
  })
})

describe('BackupManager: выдача приватного ключа', () => {
  it('выдаёт ключ HD-аккаунта', async () => {
    const secret = await backup.exportPrivateKey(
      firstAccountId(),
      PASSWORD,
      EXPORT_RISK.AccountCompromise,
    )

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()
  })

  it('отвергает неверный пароль и не пишет в журнал', async () => {
    const id = firstAccountId()

    await expect(
      backup.exportPrivateKey(id, WRONG_PASSWORD, EXPORT_RISK.AccountCompromise),
    ).rejects.toThrow(InvalidPasswordError)

    await expect(
      auditLog.hasExported(hdAccountScope(hdWallet.accountPath), EXPORT_KIND.PrivateKey),
    ).resolves.toBe(false)
  })

  it('отказывает при заниженном уровне риска', async () => {
    await expect(
      backup.exportPrivateKey(firstAccountId(), PASSWORD, EXPORT_RISK.Low),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('выдаёт импортированный ключ и не задевает область HD-аккаунта', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)
    const imported = await accounts.importPrivateKey({ privateKey: key })

    key.wipe()

    const secret = await backup.exportPrivateKey(
      imported.id,
      PASSWORD,
      EXPORT_RISK.AccountCompromise,
    )

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()

    /* Импортированный ключ не принадлежит HD-дереву: пометив им аккаунт,
       кошелёк выдавал бы ложное предупреждение о компрометации. */
    await expect(
      auditLog.hasExported(hdAccountScope(hdWallet.accountPath), EXPORT_KIND.PrivateKey),
    ).resolves.toBe(false)
  })

  it('разрешение одноразово: повторная выдача требует нового подтверждения', async () => {
    const id = firstAccountId()

    ;(await backup.exportPrivateKey(id, PASSWORD, EXPORT_RISK.AccountCompromise)).wipe()

    /* Второй вызов проходит заново через оценку и подтверждение —
       разрешение от первого использовать нельзя. */
    const secret = await backup.exportPrivateKey(id, PASSWORD, EXPORT_RISK.AccountCompromise)

    expect(secret.bytes).toHaveLength(32)
    secret.wipe()
  })
})

describe('BackupManager: проверка фразы перед импортом', () => {
  it('принимает действительную фразу', () => {
    const check = backup.checkMnemonic(TEST_MNEMONIC)

    expect(check.isValid).toBe(true)
    expect(check.wordCount).toBe(12)
  })

  it('называет причину при неверной контрольной сумме', () => {
    const swapped = TEST_MNEMONIC.replace('about', 'abandon')

    expect(backup.checkMnemonic(swapped).reason).toBe(MNEMONIC_INVALID_REASON.Checksum)
  })

  it('указывает позиции слов вне словаря', () => {
    const broken = TEST_MNEMONIC.replace('abandon abandon abandon a', 'abandon abandon зомби a')

    expect(backup.checkMnemonic(broken).unknownWordIndexes).toEqual([2])
  })

  it('предупреждает о тривиальной энтропии', () => {
    expect(backup.checkMnemonic(TEST_MNEMONIC).isGuessable).toBe(true)
  })

  it('тестовая фраза действительно соответствует нулевой энтропии', () => {
    /* Проверка самой константы: она выписана строкой, а строку нельзя
       проверить чтением. Фраза, построенная из шестнадцати нулевых байт,
       обязана совпасть с ней слово в слово. */
    const built = mnemonicService.fromEntropy(new Uint8Array(16))

    expect(readAndWipe(built)).toBe(TEST_MNEMONIC)
  })

  it('фразу со случайной энтропией тривиальной не считает', () => {
    const generated = mnemonicService.generate()
    const phrase = mnemonicService.revealPhrase(generated)

    generated.wipe()

    expect(backup.checkMnemonic(phrase).isGuessable).toBe(false)
  })

  it('не бросает исключений на незаконченном вводе', () => {
    expect(() => backup.checkMnemonic('abandon aban')).not.toThrow()
    expect(backup.checkMnemonic('abandon aban').isValid).toBe(false)
  })

  it('пустой ввод тривиальным не считает', () => {
    /* «Энтропия неизвестна» и «энтропия слабая» — разные утверждения.
       Второе, показанное вместо первого, — ложная тревога. */
    expect(backup.checkMnemonic('').isGuessable).toBe(false)
  })
})

/** Идентификатор единственного созданного аккаунта. */
function firstAccountId(): AccountId {
  const account = accounts.list()[0]

  if (account === undefined) {
    throw new Error('Аккаунт не создан.')
  }

  return account.id
}
