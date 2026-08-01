import { beforeEach, describe, expect, it } from 'vitest'

import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  ExportNotPermittedError,
  InvalidPasswordError,
  WALLET_SCOPE,
  accountExportRequest,
  hdAccountScope,
  privateKeyExportRequest,
  toAddress,
  toDerivationPath,
  toWei,
  type AccountId,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, FakeClock, InMemoryStorageService } from '@/test/doubles'
import type { ITestAppServices } from '@/test/doubles'

const PASSWORD = 'Korova-7-Luna!'
const WRONG_PASSWORD = 'Sobaka-9-Solnce!'

const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)
const OUTSIDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

const BALANCE = (10n ** 19n) as Wei

let services: ITestAppServices

/** Открывает разблокированную сессию с готовым аккаунтом. */
async function openSession(): Promise<void> {
  services.providerFactory.configure({ balance: BALANCE })
  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
  await services.session.open()
}

/** Идентификатор первого аккаунта кошелька. */
function firstAccountId(): AccountId {
  const account = services.session.getSnapshot().accounts[0]

  if (account === undefined) {
    throw new Error('Аккаунт не создан.')
  }

  return account.id
}

beforeEach(() => {
  services = createTestAppServices()
})

describe('Заблокированный кошелёк не выполняет операций', () => {
  it('сессия закрывается и очищает снимок', async () => {
    await openSession()

    expect(services.session.getSnapshot().accounts).not.toHaveLength(0)

    await services.session.close()

    expect(services.session.getSnapshot().accounts).toHaveLength(0)
    expect(services.session.getSnapshot().activeAccount).toBeNull()
  })

  it('резервное копирование недоступно после закрытия', async () => {
    /* Экран экспорта, оставшийся работоспособным после автоблокировки,
       обесценил бы саму автоблокировку. */
    await openSession()
    await services.session.close()

    expect(() => services.session.getBackup()).toThrow()
  })

  it('подготовка перевода после закрытия отказывает', async () => {
    await openSession()
    const chainId = services.session.getSnapshot().activeNetwork?.chainId

    if (chainId === undefined) {
      throw new Error('Сеть не выбрана.')
    }

    await services.session.close()

    await expect(
      services.session.prepareTransfer({
        chainId,
        from: OWNER,
        to: OUTSIDER,
        value: toWei(1n),
      }),
    ).rejects.toThrow()
  })

  it('повторная блокировка не ломает состояние', async () => {
    await openSession()
    await services.session.close()

    await expect(services.session.close()).resolves.toBeUndefined()
  })
})

describe('Выдача секретов требует пароля даже при снятой блокировке', () => {
  it('seed-фраза не выдаётся по неверному паролю', async () => {
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('приватный ключ не выдаётся по неверному паролю', async () => {
    await openSession()

    await expect(
      services.session
        .getBackup()
        .exportPrivateKey(firstAccountId(), WRONG_PASSWORD, EXPORT_RISK.AccountCompromise),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('заниженный уровень риска не даёт выдачи', async () => {
    /* Интерфейс, показавший мягкое предупреждение там, где нужно
       объяснение необратимых последствий, разрешения не получит. */
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(PASSWORD, EXPORT_RISK.Elevated),
    ).rejects.toThrow(ExportNotPermittedError)
  })

  it('неверный пароль не оставляет следа в журнале экспортов', async () => {
    /* Журнал, полный несостоявшихся выгрузок, завышал бы оценку риска
       последующих операций — то есть учил бы не читать предупреждения. */
    await openSession()

    await expect(
      services.session.getBackup().exportMnemonic(WRONG_PASSWORD, EXPORT_RISK.Critical),
    ).rejects.toThrow(InvalidPasswordError)

    const assessment = await services.session.getBackup().assessMnemonicExport()

    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
    expect(assessment.closesCompromisePair).toBe(false)
  })
})

describe('Разрешение на экспорт одноразово и привязано к операции', () => {
  /* Путь строится конструктором, а не приведением типом: приведение
     обошло бы проверку формата, ради которой брендированный тип
     и существует. */
  const ACCOUNT_SCOPE = hdAccountScope(toDerivationPath("m/44'/60'/0'"))

  let guard: ExportGuard

  beforeEach(() => {
    guard = new ExportGuard(
      new ExportAuditLog(new InMemoryStorageService()),
      new FakeClock(1_700_000_000_000),
    )
  })

  it('разрешение не подходит к другому виду секрета', async () => {
    const permit = await guard.confirm(
      accountExportRequest(EXPORT_KIND.Xpub, ACCOUNT_SCOPE),
      EXPORT_RISK.Elevated,
    )

    expect(permit.matches(EXPORT_KIND.Xprv, ACCOUNT_SCOPE, null)).toBe(false)
  })

  it('разрешение не подходит к другому адресу', async () => {
    const permit = await guard.confirm(
      privateKeyExportRequest(ACCOUNT_SCOPE, 0),
      EXPORT_RISK.Elevated,
    )

    expect(permit.matches(EXPORT_KIND.PrivateKey, ACCOUNT_SCOPE, 1)).toBe(false)
  })

  it('использованное разрешение больше не подходит ни к чему', async () => {
    /* Иначе одно подтверждение пользователя открывало бы неограниченное
       число выгрузок. */
    const request = privateKeyExportRequest(ACCOUNT_SCOPE, 0)
    const permit = await guard.confirm(request, EXPORT_RISK.Elevated)

    expect(permit.matches(EXPORT_KIND.PrivateKey, request.scope, 0)).toBe(true)

    permit.consume()

    expect(permit.matches(EXPORT_KIND.PrivateKey, request.scope, 0)).toBe(false)
  })

  it('разрешение не раскрывает состояния при сериализации', () => {
    /* Само по себе оно безопасно и может попадать в журнал, но только
       в том виде, в каком задумано. */
    expect(JSON.stringify(guard)).not.toContain('secret')
  })

  it('область seed-фразы отличается от области аккаунта', async () => {
    /* Фраза выводит все аккаунты, включая ещё не созданные: записав её
       выдачу под путём одного аккаунта, журнал утверждал бы, что риск
       ограничен этим аккаунтом. */
    const assessment = await guard.assess(accountExportRequest(EXPORT_KIND.Mnemonic, WALLET_SCOPE))

    expect(assessment.request.scope).toBe(WALLET_SCOPE)
    expect(assessment.risk).toBe(EXPORT_RISK.Critical)
  })
})
