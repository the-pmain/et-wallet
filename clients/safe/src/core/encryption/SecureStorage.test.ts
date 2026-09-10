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

const PASSWORD = 'correct-password-1234'
const NEW_PASSWORD = 'new-password-5678'

const VAULT_KEY: StorageKey = toStorageKey('vault')

/**
 * Private key from the stage-5 test vector.
 *
 * Chosen so it is easy to search for in raw storage: if it appears
 * there in any form, the test must fail.
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

/** Raw backing-store contents as one string. */
async function dumpRawStorage(): Promise<string> {
  const parts: string[] = []

  for (const namespace of Object.values(STORAGE_NAMESPACE)) {
    for (const key of await storage.keys(namespace)) {
      parts.push(key, JSON.stringify(await storage.get<unknown>(namespace, key)))
    }
  }

  return parts.join('\n')
}

describe('SecureStorage: initialise and lock', () => {
  it('starts uninitialised and locked', async () => {
    await expect(secure.isInitialized()).resolves.toBe(false)
    expect(secure.isUnlocked).toBe(false)
  })

  it('stays unlocked after initialise', async () => {
    await secure.initialize(PASSWORD)

    expect(secure.isUnlocked).toBe(true)
    await expect(secure.isInitialized()).resolves.toBe(true)
  })

  it('rejects a second initialise', async () => {
    await secure.initialize(PASSWORD)

    await expect(secure.initialize(PASSWORD)).rejects.toThrow(WalletAlreadyInitializedError)
  })

  it('unlocks with the correct password after lock', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    expect(secure.isUnlocked).toBe(false)

    await secure.unlock(PASSWORD)

    expect(secure.isUnlocked).toBe(true)
  })

  it('rejects a wrong password', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    await expect(secure.unlock('wrong')).rejects.toThrow(InvalidPasswordError)
    expect(secure.isUnlocked).toBe(false)
  })

  it('rejects unlock on an uninitialised store', async () => {
    await expect(secure.unlock(PASSWORD)).rejects.toThrow(WalletNotInitializedError)
  })

  it('survives recreating the object on the same store', async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 42 })

    const restored = new SecureStorage(storage, new FastEncryptionService())
    await restored.unlock(PASSWORD)

    await expect(restored.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({ value: 42 })
  })

  it('allows locking again', async () => {
    await secure.initialize(PASSWORD)
    secure.lock()

    expect(() => {
      secure.lock()
    }).not.toThrow()
  })
})

describe('SecureStorage: private keys are not stored in the clear', () => {
  /* The main check of this stage. Everything else is secondary: if a
     secret lands in storage in the clear, encryption strength does not
     matter. */

  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('the private key does not appear in raw storage', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    expect(await dumpRawStorage()).not.toContain(PRIVATE_KEY_HEX)
  })

  it('the mnemonic does not appear in raw storage', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { mnemonic: MNEMONIC })

    const raw = await dumpRawStorage()

    expect(raw).not.toContain(MNEMONIC)
    expect(raw).not.toContain('abandon')
  })

  it('does not even reveal value field names', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    expect(await dumpRawStorage()).not.toContain('privateKey')
  })

  it('the password does not appear in raw storage', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })

    expect(await dumpRawStorage()).not.toContain(PASSWORD)
  })

  it('writes the value in a ciphertext envelope', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    const stored = await storage.get<Record<string, unknown>>(STORAGE_NAMESPACE.Vault, VAULT_KEY)

    expect(stored?.['__type']).toBe('enc')
    expect(stored?.['payload']).toBeDefined()
  })

  it('keeps the secret readable after unlock', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })
    secure.lock()
    await secure.unlock(PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })
})

describe('SecureStorage: data access', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('returns null for a missing record', async () => {
    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBeNull()
  })

  it('preserves the value structure', async () => {
    const value = { list: [1, 2, 3], nested: { flag: true }, text: 'value' }
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, value)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual(value)
  })

  it('overwrites a value', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { version: 1 })
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { version: 2 })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({ version: 2 })
  })

  it('removes a record', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    await secure.remove(STORAGE_NAMESPACE.Vault, VAULT_KEY)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBeNull()
  })

  it('reports that a record exists without decrypting it', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()

    await expect(secure.has(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toBe(true)
  })

  it('lists keys without decrypting values', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()

    await expect(secure.keys(STORAGE_NAMESPACE.Vault)).resolves.toEqual([VAULT_KEY])
  })

  it('keeps namespaces separate', async () => {
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

describe('SecureStorage: reject when locked', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })
    secure.lock()
  })

  it('rejects a read', async () => {
    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(WalletLockedError)
  })

  it('rejects a write', async () => {
    await expect(secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 2 })).rejects.toThrow(
      WalletLockedError,
    )
  })
})

describe('SecureStorage: detecting foreign contents', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
  })

  it('rejects a record written around encryption', async () => {
    /* Such a record means some code writes a secret straight through
       IStorageService. Returning it silently would hide the leak. */
    await storage.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(
      VaultCorruptedError,
    )
  })

  it('rejects a corrupted envelope', async () => {
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { value: 1 })

    const stored = await storage.get<Record<string, unknown>>(STORAGE_NAMESPACE.Vault, VAULT_KEY)
    await storage.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { ...stored, payload: { version: 1 } })

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).rejects.toThrow(
      VaultCorruptedError,
    )
  })
})

describe('SecureStorage: password change', () => {
  beforeEach(async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })
    await secure.set(STORAGE_NAMESPACE.Accounts, toStorageKey('list'), { count: 3 })
  })

  it('keeps data readable', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
    await expect(secure.get(STORAGE_NAMESPACE.Accounts, toStorageKey('list'))).resolves.toEqual({
      count: 3,
    })
  })

  it('opens the store with the new password', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)
    secure.lock()
    await secure.unlock(NEW_PASSWORD)

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })

  it('stops opening with the old password', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)
    secure.lock()

    await expect(secure.unlock(PASSWORD)).rejects.toThrow(InvalidPasswordError)
  })

  it('rejects a wrong current password', async () => {
    await expect(secure.changePassword('wrong', NEW_PASSWORD)).rejects.toThrow(
      InvalidPasswordError,
    )
  })

  it('does not touch data on failure', async () => {
    await expect(secure.changePassword('wrong', NEW_PASSWORD)).rejects.toThrow()

    await expect(secure.get(STORAGE_NAMESPACE.Vault, VAULT_KEY)).resolves.toEqual({
      privateKey: PRIVATE_KEY_HEX,
    })
  })

  it('changes the salt, not only the key', async () => {
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

  it('does not leave the secret in the clear after re-encryption', async () => {
    await secure.changePassword(PASSWORD, NEW_PASSWORD)

    expect(await dumpRawStorage()).not.toContain(PRIVATE_KEY_HEX)
  })
})

describe('SecureStorage: full wipe', () => {
  it('erases all data and locks the store', async () => {
    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, VAULT_KEY, { privateKey: PRIVATE_KEY_HEX })

    await secure.destroy()

    expect(secure.isUnlocked).toBe(false)
    await expect(secure.isInitialized()).resolves.toBe(false)
    expect(await dumpRawStorage()).toBe('')
  })
})
