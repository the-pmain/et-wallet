import { beforeEach, describe, expect, it } from 'vitest'

import {
  InvalidPasswordError,
  VaultCorruptedError,
  WalletAlreadyInitializedError,
  WalletLockedError,
  WalletNotInitializedError,
} from '@/core/errors'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import { FastEncryptionService, InMemoryStorageService } from '@/test/doubles'

import { SecureStorage } from './SecureStorage'

const PASSWORD = 'правильный-пароль-1234'
const NEW_PASSWORD = 'новый-пароль-5678'

const VAULT_KEY: StorageKey = toStorageKey('vault')

/**
 * Приватный ключ из тестового вектора этапа 5.
 *
 * Значение подобрано так, чтобы его было легко искать в сыром содержимом
 * хранилища: если оно там встретится в любом виде, тест обязан упасть.
 */
const PRIVATE_KEY_HEX = '1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727'
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

let storage: InMemoryStorageService
let secure: SecureStorage

beforeEach(() => {
  storage = new InMemoryStorageService()
  secure = new SecureStorage(storage, new FastEncryptionService())
})

/** Сырое содержимое нижележащего хранилища одной строкой. */
async function dumpRawStorage(): Promise<string> {
  const parts: string[] = []

  for (const namespace of Object.values(STORAGE_NAMESPACE)) {
    for (const key of await storage.keys(namespace)) {
      parts.push(key, JSON.stringify(await storage.get<unknown>(namespace, key)))
    }
  }

  return parts.join('\n')
}

describe('SecureStorage: инициализация и блокировка', () => {
  it('изначально не инициализировано и заблокировано', async () => {
    await expect(secure.isInitialized()).resolves.toBe(false)
    expect(secure.isUnlocked).toBe(false)
  })

  it('после инициализации остаётся разблокированным', async () => {
    await secure.initialize(PASSWORD)

    expect(secure.isUnlocked).toBe(true)
    await expect(secure.isInitialized()).resolves.toBe(true)
  })

  it('отказывает в повторной инициализации', async () => {
    await secure.initialize(PASSWORD)

    await expect(secure.initialize(PASSWORD)).rejects.toThrow(WalletAlreadyInitializedError)
  })

  it('разблокируется верным паролем после блокировки', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    expect(secure.isUnlocked).toBe(false)

    await secure.unlock(PASSWORD)

    expect(secure.isUnlocked).toBe(true)
  })

  it('отвергает неверный пароль', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    await expect(secure.unlock('неверный')).rejects.toThrow(InvalidPasswordError)
    expect(secure.isUnlocked).toBe(false)
  })

  it('отвергает разблокировку неинициализированного хранилища', async () => {
    await expect(secure.unlock(PASSWORD)).rejects.toThrow(WalletNotInitializedError)
  })

  it('переживает пересоздание объекта поверх того же хранилища', async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 42 })

    const restored = new SecureStorage(storage, new FastEncryptionService())
    await restored.unlock(PASSWORD)

    await expect(restored.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({ value: 42 })
  })

  it('допускает повторную блокировку', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    expect(() => {
      secure.lock()
    }).not.toThrow()
  })
})

describe('SecureStorage: приватные ключи не хранятся в открытом виде', () => {
  /* Главная проверка этапа. Всё остальное вторично: если секрет
     оказывается в хранилище открытым, стойкость шифрования значения
     не имеет. */

  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('приватный ключ не встречается в сыром хранилище', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    expect(await dumpRawStorage()).not.toContain(PRIVATE_KEY_HEX)
  })

  it('мнемоническая фраза не встречается в сыром хранилище', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { mnemonic: MNEMONIC })

    const raw = await dumpRawStorage()

    expect(raw).not.toContain(MNEMONIC)
    expect(raw).not.toContain('abandon')
  })

  it('не раскрывает даже имена полей значения', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    expect(await dumpRawStorage()).not.toContain('privateKey')
  })

  it('пароль не встречается в сыром хранилище', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })

    expect(await dumpRawStorage()).not.toContain(PASSWORD)
  })

  it('записывает значение в конверте с шифротекстом', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    const stored = await storage.get<Record<string, unknown>>(STORAGE_NAMESPACE.Vault, VAULT_KEY)

    expect(stored?.['__type']).toBe('enc')
    expect(stored?.['payload']).toBeDefined()
  })

  it('сохраняет секрет читаемым после разблокировки', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })
    secure.lock()
    await secure.unlock(PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })
})

describe('SecureStorage: доступ к данным', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('возвращает null для отсутствующей записи', async () => {
    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBeNull()
  })

  it('сохраняет структуру значения', async () => {
    const value = { list: [1, 2, 3], nested: { flag: true }, text: 'значение' }
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, value)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual(value)
  })

  it('перезаписывает значение', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { version: 1 })
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { version: 2 })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({ version: 2 })
  })

  it('удаляет запись', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    await secure.remove(STORAGE_NAMESPACE.Vault, VAULT_KEY)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBeNull()
  })

  it('сообщает о наличии записи, не расшифровывая её', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()

    await expect(secure.has(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBe(true)
  })

  it('перечисляет ключи, не расшифровывая значения', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()

    await expect(secure.keys(STORAGE_NAMESPACE.Vault)).resolves.toEqual([VAULT_KEY])
  })

  it('разделяет пространства имён', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { where: 'vault' })
    await secure.set(STORAGE_NAMESPACE.Accounts, VAULT_KEY, { where: 'accounts' })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      where: 'vault',
    })
    await expect(secure.get(STORAGE_NAMESPACE.Accounts, VAULT_KEY)).resolves.toEqual({
      where: 'accounts',
    })
  })
})

describe('SecureStorage: отказ при блокировке', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()
  })

  it('отказывает в чтении', async () => {
    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(WalletLockedError)
  })

  it('отказывает в записи', async () => {
    await expect(secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 2 })).rejects.toThrow(
      WalletLockedError,
    )
  })
})

describe('SecureStorage: обнаружение постороннего содержимого', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('отвергает запись, положенную в обход шифрования', async () => {
    /* Такая запись означает, что где-то в коде секрет пишется напрямую
       через IStorageService. Молча вернуть её значило бы скрыть утечку. */
    await storage.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(
      VaultCorruptedError,
    )
  })

  it('отвергает повреждённый конверт', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })

    const stored = await storage.get<Record<string, unknown>>(STORAGE_NAMESPACE.Vault, VAULT_KEY)
    await storage.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { ...stored, payload: { version: 1 } })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(
      VaultCorruptedError,
    )
  })
})

describe('SecureStorage: смена пароля', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })
    await secure.set(STORAGE_NAMESPACE.Accounts, toStorageKey('list'), { count: 3 })
  })

  it('сохраняет данные читаемыми', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
    await expect(secure.get(STORAGE_NAMESPACE.Accounts, toStorageKey('list'))).resolves.toEqual({
      count: 3,
    })
  })

  it('открывает хранилище новым паролем', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)
    secure.lock()
    await secure.unlock(NEW_PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })

  it('перестаёт открываться прежним паролем', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)
    secure.lock()

    await expect(secure.unlock(PASSWORD)).rejects.toThrow(InvalidPasswordError)
  })

  it('отвергает неверный текущий пароль', async () => {
    await expect(secure.changePassword('неверный', NEW_PASSWORD)).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('не трогает данные при отказе', async () => {
    await expect(secure.changePassword('неверный', NEW_PASSWORD)).rejects.toThrow()

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })

  it('меняет соль, а не только ключ', async () => {
    const before = await storage.get<Record<string, unknown>>(
      STORAGE_NAMESPACE.Settings,
      toStorageKey('secure-storage.header'),
    )

    await secure.changePassword(PASSWORD, NEW_PASSWORD)

    const after = await storage.get<Record<string, unknown>>(
      STORAGE_NAMESPACE.Settings,
      toStorageKey('secure-storage.header'),
    )

    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before))
  })

  it('не оставляет секрет открытым после перешифровки', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)

    expect(await dumpRawStorage()).not.toContain(PRIVATE_KEY_HEX)
  })
})

describe('SecureStorage: полное удаление', () => {
  it('стирает все данные и блокирует хранилище', async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    await secure.destroy()

    expect(secure.isUnlocked).toBe(false)
    await expect(secure.isInitialized()).resolves.toBe(false)
    expect(await dumpRawStorage()).toBe('')
  })
})
