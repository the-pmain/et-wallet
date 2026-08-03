import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toAddress } from '@/core/address'
import { SecretBuffer, SecureStorage } from '@/core/encryption'
import {
  AccountAlreadyExistsError,
  AccountNotFoundError,
  AccountNotRemovableError,
  ExportNotPermittedError,
  InvalidArgumentError,
  InvalidPasswordError,
  InvalidPrivateKeyError,
  NotInitializedError,
} from '@/core/errors'
import { HDWalletService } from '@/core/hdwallet'
import { KEYRING_TYPE } from '@/core/keyring'
import { MnemonicService } from '@/core/mnemonic'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  hdAccountScope,
  importedKeyScope,
  privateKeyExportRequest,
  type ExportPermit,
} from '@/core/security'
import type { AccountId, KeyringId } from '@/core/types'
import {
  FakeClock,
  FastEncryptionService,
  InMemoryStorageService,
  NullLogger,
} from '@/test/doubles'

import { AccountManager } from './AccountManager'
import { MAX_ACCOUNT_NAME_LENGTH } from './identity'

const PASSWORD = 'правильный-пароль-1234'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Приватный ключ, равный единице. Его адрес общеизвестен. */
const IMPORTED_KEY = new Uint8Array(32)
IMPORTED_KEY[31] = 1
const IMPORTED_ADDRESS = toAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')

/** Второй ключ для проверки повторного импорта другого адреса. */
const OTHER_KEY = new Uint8Array(32)
OTHER_KEY[31] = 2

let storage: InMemoryStorageService
let secure: SecureStorage
let hdWallet: HDWalletService
let clock: FakeClock
let logger: NullLogger
let manager: AccountManager
let guard: ExportGuard

async function createManager(): Promise<AccountManager> {
  const created = AccountManager.create({ hdWallet, secureStorage: secure, clock, logger })
  await created.init()

  return created
}

/**
 * Разрешение на экспорт импортированного ключа.
 *
 * Область — собственная для каждого импортированного ключа, а не путь
 * HD-аккаунта. Иначе выдача импортированного ключа помечала бы HD-аккаунт
 * скомпрометированным, хотя эти два секрета никак не связаны.
 */
async function permitForImported(keyringId: KeyringId): Promise<ExportPermit> {
  return await guard.confirm(
    privateKeyExportRequest(importedKeyScope(keyringId), null),
    EXPORT_RISK.Critical,
  )
}

async function permitForHd(addressIndex: number): Promise<ExportPermit> {
  return await guard.confirm(
    privateKeyExportRequest(hdAccountScope(hdWallet.accountPath), addressIndex),
    EXPORT_RISK.Critical,
  )
}

beforeEach(async () => {
  storage = new InMemoryStorageService()
  secure = new SecureStorage(storage, new FastEncryptionService())
  await secure.initialize(PASSWORD)

  const mnemonicService = new MnemonicService()
  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)
  const seed = await mnemonicService.toSeed(mnemonic)
  mnemonic.wipe()

  hdWallet = HDWalletService.fromSeed(seed)
  seed.wipe()

  clock = new FakeClock(1_700_000_000_000)
  logger = new NullLogger()
  guard = new ExportGuard(new ExportAuditLog(storage), clock)

  manager = await createManager()
})

describe('AccountManager: инициализация', () => {
  it('до init() отказывает в доступе к списку', () => {
    const fresh = AccountManager.create({ hdWallet, secureStorage: secure, clock, logger })

    expect(() => fresh.list()).toThrow(NotInitializedError)
  })

  it('начинает с пустого списка', () => {
    expect(manager.list()).toHaveLength(0)
    expect(manager.getActive()).toBeNull()
  })

  it('идемпотентен при повторном вызове', async () => {
    await manager.create()
    await manager.init()

    expect(manager.list()).toHaveLength(1)
  })

  it('восстанавливает аккаунты после пересоздания', async () => {
    await manager.create()
    await manager.create({ name: 'Второй' })

    const restored = await createManager()

    expect(restored.list()).toHaveLength(2)
    expect(restored.list()[1]?.name).toBe('Второй')
  })
})

describe('AccountManager: создание аккаунтов', () => {
  it('создаёт аккаунт с адресом из HD-дерева', async () => {
    const account = await manager.create()

    expect(account.address).toBe(hdWallet.getAddress(0))
    expect(account.source).toBe(KEYRING_TYPE.Hd)
    expect(account.addressIndex).toBe(0)
    expect(account.derivationPath).toBe("m/44'/60'/0'/0/0")
  })

  it('назначает имя по умолчанию', async () => {
    expect((await manager.create()).name).toBe('Account 1')
    expect((await manager.create()).name).toBe('Account 2')
  })

  it('принимает заданное имя', async () => {
    expect((await manager.create({ name: '  Зарплата  ' })).name).toBe('Зарплата')
  })

  it('наращивает индекс адреса', async () => {
    await manager.create()
    const second = await manager.create()

    expect(second.addressIndex).toBe(1)
    expect(second.address).toBe(hdWallet.getAddress(1))
  })

  it('не повторяет индекс после скрытия аккаунта', async () => {
    /* Индекс берётся как максимальный плюс один, а не как число
       аккаунтов: подсчёт по количеству после скрытия дал бы повторный
       индекс, то есть два аккаунта с одним адресом. */
    const first = await manager.create()
    await manager.create()
    await manager.setHidden(first.id, false)
    await manager.setActive((manager.list()[1] as { id: AccountId }).id)
    await manager.setHidden(first.id, true)

    expect((await manager.create()).addressIndex).toBe(2)
  })

  it('назначает первый созданный аккаунт активным', async () => {
    const account = await manager.create()

    expect(manager.getActive()?.id).toBe(account.id)
  })

  it('не меняет активный при создании последующих', async () => {
    const first = await manager.create()
    await manager.create()

    expect(manager.getActive()?.id).toBe(first.id)
  })

  it('порождает событие изменения списка', async () => {
    const listener = vi.fn()
    manager.on('account:listChanged', listener)

    await manager.create()

    expect(listener).toHaveBeenCalledOnce()
  })

  it('не содержит приватного ключа в структуре аккаунта', async () => {
    const account = await manager.create()

    expect(JSON.stringify(account)).not.toContain('privateKey')
  })
})

describe('AccountManager: импорт приватного ключа', () => {
  it('импортирует ключ и выводит адрес', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const account = await manager.importPrivateKey({ privateKey: key })

      expect(account.address).toBe(IMPORTED_ADDRESS)
      expect(account.source).toBe(KEYRING_TYPE.PrivateKey)
      expect(account.addressIndex).toBeNull()
      expect(account.derivationPath).toBeNull()
    } finally {
      key.wipe()
    }
  })

  it('не затирает переданный буфер', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      await manager.importPrivateKey({ privateKey: key })

      expect(key.isWiped).toBe(false)
    } finally {
      key.wipe()
    }
  })

  it('отвергает повторный импорт того же адреса', async () => {
    const first = SecretBuffer.copyOf(IMPORTED_KEY)
    const second = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      await manager.importPrivateKey({ privateKey: first })

      await expect(manager.importPrivateKey({ privateKey: second })).rejects.toThrow(
        AccountAlreadyExistsError,
      )
    } finally {
      first.wipe()
      second.wipe()
    }
  })

  it('отвергает непригодный ключ', async () => {
    const zero = SecretBuffer.allocate(32)

    try {
      await expect(manager.importPrivateKey({ privateKey: zero })).rejects.toThrow(
        InvalidPrivateKeyError,
      )
    } finally {
      zero.wipe()
    }
  })

  it('не сохраняет непригодный ключ в хранилище', async () => {
    const zero = SecretBuffer.allocate(32)

    try {
      await expect(manager.importPrivateKey({ privateKey: zero })).rejects.toThrow()

      expect(manager.list()).toHaveLength(0)
    } finally {
      zero.wipe()
    }
  })

  it('не хранит импортированный ключ в открытом виде', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      await manager.importPrivateKey({ privateKey: key })

      const raw: string[] = []

      for (const namespace of ['vault', 'accounts', 'settings'] as const) {
        for (const storageKey of await storage.keys(namespace)) {
          raw.push(JSON.stringify(await storage.get<unknown>(namespace, storageKey)))
        }
      }

      expect(raw.join('\n')).not.toContain(
        '0000000000000000000000000000000000000000000000000000000000000001',
      )
      expect(raw.join('\n')).not.toContain(IMPORTED_ADDRESS)
    } finally {
      key.wipe()
    }
  })

  it('даёт импортированным аккаунтам разные наборы ключей', async () => {
    const first = SecretBuffer.copyOf(IMPORTED_KEY)
    const second = SecretBuffer.copyOf(OTHER_KEY)

    try {
      const one = await manager.importPrivateKey({ privateKey: first })
      const two = await manager.importPrivateKey({ privateKey: second })

      expect(one.keyringId).not.toBe(two.keyringId)
    } finally {
      first.wipe()
      second.wipe()
    }
  })
})

describe('AccountManager: переименование', () => {
  let accountId: AccountId

  beforeEach(async () => {
    accountId = (await manager.create()).id
  })

  it('меняет имя', async () => {
    await manager.rename(accountId, 'Основной')

    expect(manager.getById(accountId)?.name).toBe('Основной')
  })

  it('обрезает пробелы и схлопывает повторяющиеся', async () => {
    await manager.rename(accountId, '  Мой   аккаунт  ')

    expect(manager.getById(accountId)?.name).toBe('Мой аккаунт')
  })

  it('удаляет управляющие символы', async () => {
    /* Перевод строки в имени ломает вёрстку списка и позволяет визуально
       подделать соседнюю строку. */
    await manager.rename(accountId, 'Имя\nПоддельная строка')

    expect(manager.getById(accountId)?.name).toBe('ИмяПоддельная строка')
  })

  it('отвергает пустое имя', async () => {
    await expect(manager.rename(accountId, '   ')).rejects.toThrow(InvalidArgumentError)
  })

  it('отвергает слишком длинное имя', async () => {
    await expect(
      manager.rename(accountId, 'а'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1)),
    ).rejects.toThrow(InvalidArgumentError)
  })

  it('отвергает несуществующий аккаунт', async () => {
    await expect(manager.rename('0'.repeat(32) as AccountId, 'Имя')).rejects.toThrow(
      AccountNotFoundError,
    )
  })

  it('сохраняет имя между сессиями', async () => {
    await manager.rename(accountId, 'Сохранённое')

    expect((await createManager()).getById(accountId)?.name).toBe('Сохранённое')
  })
})

describe('AccountManager: выбор активного', () => {
  it('меняет активный аккаунт', async () => {
    await manager.create()
    const second = await manager.create()

    await manager.setActive(second.id)

    expect(manager.getActive()?.id).toBe(second.id)
  })

  it('порождает событие смены активного', async () => {
    await manager.create()
    const second = await manager.create()

    const listener = vi.fn()
    manager.on('account:activeChanged', listener)
    await manager.setActive(second.id)

    expect(listener).toHaveBeenCalledExactlyOnceWith({ address: second.address })
  })

  it('не порождает событие при выборе уже активного', async () => {
    const first = await manager.create()

    const listener = vi.fn()
    manager.on('account:activeChanged', listener)
    await manager.setActive(first.id)

    expect(listener).not.toHaveBeenCalled()
  })

  it('отказывает в выборе скрытого аккаунта', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setHidden(second.id, true)

    await expect(manager.setActive(second.id)).rejects.toThrow(InvalidArgumentError)
  })

  it('восстанавливает выбор между сессиями', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setActive(second.id)

    expect((await createManager()).getActive()?.id).toBe(second.id)
  })
})

describe('AccountManager: скрытие', () => {
  it('скрывает аккаунт', async () => {
    await manager.create()
    const second = await manager.create()

    await manager.setHidden(second.id, true)

    expect(manager.listVisible()).toHaveLength(1)
    expect(manager.list()).toHaveLength(2)
  })

  it('возвращает скрытый аккаунт', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setHidden(second.id, true)
    await manager.setHidden(second.id, false)

    expect(manager.listVisible()).toHaveLength(2)
  })

  it('отказывает в скрытии активного аккаунта', async () => {
    const first = await manager.create()
    await manager.create()

    await expect(manager.setHidden(first.id, true)).rejects.toThrow(InvalidArgumentError)
  })

  it('отказывает в скрытии последнего видимого', async () => {
    const only = await manager.create()

    await expect(manager.setHidden(only.id, true)).rejects.toThrow(InvalidArgumentError)
  })
})

describe('AccountManager: удаление', () => {
  it('отказывает в удалении аккаунта из HD-дерева', async () => {
    /* Аккаунт, выведенный из seed-фразы, появится снова при следующем
       восстановлении кошелька. Кнопка «удалить», которая лишь прячет
       запись, вводит пользователя в заблуждение. */
    const account = await manager.create()

    await expect(manager.remove(account.id, PASSWORD)).rejects.toThrow(AccountNotRemovableError)
  })

  it('удаляет импортированный аккаунт', async () => {
    await manager.create()
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })
      await manager.remove(imported.id, PASSWORD)

      expect(manager.getById(imported.id)).toBeNull()
    } finally {
      key.wipe()
    }
  })

  it('удаляет вместе с ним приватный ключ', async () => {
    await manager.create()
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })
      await manager.remove(imported.id, PASSWORD)

      const vaultKeys = await storage.keys('vault')

      expect(vaultKeys.some((entry) => entry.includes(imported.id))).toBe(false)
    } finally {
      key.wipe()
    }
  })

  it('требует пароль', async () => {
    await manager.create()
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })

      await expect(manager.remove(imported.id, 'неверный')).rejects.toThrow(InvalidPasswordError)
      expect(manager.getById(imported.id)).not.toBeNull()
    } finally {
      key.wipe()
    }
  })

  it('переключает активный аккаунт при удалении активного', async () => {
    const hd = await manager.create()
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })
      await manager.setActive(imported.id)
      await manager.remove(imported.id, PASSWORD)

      expect(manager.getActive()?.id).toBe(hd.id)
    } finally {
      key.wipe()
    }
  })

  it('отказывает в удалении единственного аккаунта', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })

      await expect(manager.remove(imported.id, PASSWORD)).rejects.toThrow(InvalidArgumentError)
    } finally {
      key.wipe()
    }
  })
})

describe('AccountManager: порядок отображения', () => {
  it('меняет порядок', async () => {
    const first = await manager.create()
    const second = await manager.create()

    await manager.reorder([second.id, first.id])

    expect(manager.list().map((account) => account.id)).toEqual([second.id, first.id])
  })

  it('отвергает неполный список', async () => {
    const first = await manager.create()
    await manager.create()

    await expect(manager.reorder([first.id])).rejects.toThrow(InvalidArgumentError)
  })

  it('сохраняет порядок между сессиями', async () => {
    const first = await manager.create()
    const second = await manager.create()
    await manager.reorder([second.id, first.id])

    expect((await createManager()).list()[0]?.id).toBe(second.id)
  })
})

describe('AccountManager: экспорт приватного ключа', () => {
  it('выдаёт ключ HD-аккаунта', async () => {
    const account = await manager.create()
    const key = await manager.exportPrivateKey(account.id, PASSWORD, await permitForHd(0))

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('выдаёт ключ импортированного аккаунта без изменений', async () => {
    const source = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: source })
      const exported = await manager.exportPrivateKey(
        imported.id,
        PASSWORD,
        await permitForImported(imported.keyringId),
      )

      try {
        expect([...exported.bytes]).toEqual([...IMPORTED_KEY])
      } finally {
        exported.wipe()
      }
    } finally {
      source.wipe()
    }
  })

  it('требует пароль даже при снятой блокировке', async () => {
    /* Снятая блокировка означает лишь, что пароль вводили когда-то,
       а не что за устройством сейчас владелец. */
    const account = await manager.create()

    await expect(
      manager.exportPrivateKey(account.id, 'неверный', await permitForHd(0)),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('требует разрешение, соответствующее операции', async () => {
    const account = await manager.create()
    const wrongPermit = await guard.confirm(
      privateKeyExportRequest(hdAccountScope(hdWallet.accountPath), 5),
      EXPORT_RISK.Critical,
    )

    await expect(manager.exportPrivateKey(account.id, PASSWORD, wrongPermit)).rejects.toThrow(
      ExportNotPermittedError,
    )
  })

  it('гасит разрешение после использования', async () => {
    const account = await manager.create()
    const permit = await permitForHd(0)

    ;(await manager.exportPrivateKey(account.id, PASSWORD, permit)).wipe()

    expect(permit.isConsumed).toBe(true)
  })

  it('записывает экспорт в журнал', async () => {
    const account = await manager.create()

    ;(await manager.exportPrivateKey(account.id, PASSWORD, await permitForHd(0))).wipe()

    await expect(guard.getHistory(hdAccountScope(hdWallet.accountPath))).resolves.toHaveLength(1)
  })

  it('обнаруживает опасное сочетание с ранее выданным xpub', async () => {
    /* xpub плюс приватный ключ любого потомка раскрывают весь аккаунт.
       Второй экспорт обязан получить уровень «компрометация аккаунта». */
    await manager.create()
    await guard.confirm(
      { kind: EXPORT_KIND.Xpub, scope: hdAccountScope(hdWallet.accountPath), addressIndex: null },
      EXPORT_RISK.Elevated,
    )

    const assessment = await guard.assess(
      privateKeyExportRequest(hdAccountScope(hdWallet.accountPath), 0),
    )

    expect(assessment.risk).toBe(EXPORT_RISK.AccountCompromise)
  })

  it('отвергает несуществующий аккаунт', async () => {
    await expect(
      manager.exportPrivateKey('0'.repeat(32) as AccountId, PASSWORD, await permitForHd(0)),
    ).rejects.toThrow(AccountNotFoundError)
  })
})

describe('AccountManager: поиск', () => {
  it('находит аккаунт по адресу без учёта регистра', async () => {
    const account = await manager.create()

    expect(manager.getByAddress(account.address.toLowerCase() as typeof account.address)?.id).toBe(
      account.id,
    )
  })

  it('возвращает null для чужого адреса', async () => {
    await manager.create()

    expect(manager.getByAddress(IMPORTED_ADDRESS)).toBeNull()
  })
})
