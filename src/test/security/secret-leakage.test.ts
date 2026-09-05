import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ConsoleLogger,
  LOG_LEVEL,
  SecretBuffer,
  SecureStorage,
  STORAGE_NAMESPACE,
  VAULT_KEY,
  toStorageKey,
  type MemoryStorageService,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import {
  createTestAppServices,
  FastEncryptionService,
  InMemoryStorageService,
  type ITestAppServices,
} from '@/test/doubles'

const PASSWORD = 'Korova-7-Luna!'
const EMAIL = 'owner@example.com'

/** First word of the test phrase. Searched in raw storage as a leak marker. */
const PHRASE_MARKER = 'abandon'

let services: ITestAppServices

/**
 * Collects everything in storage into one string.
 *
 * Every namespace is walked: a leak in any of them is a leak,
 * and checking one would create false calm.
 */
async function dumpStorage(storage: MemoryStorageService): Promise<string> {
  const parts: string[] = []

  for (const namespace of Object.values(STORAGE_NAMESPACE)) {
    for (const key of await storage.keys(namespace)) {
      parts.push(key, JSON.stringify(await storage.get(namespace, key)))
    }
  }

  return parts.join('\n')
}

beforeEach(() => {
  services = createTestAppServices()
})

describe('Secrets do not reach storage in plaintext', () => {
  it('the seed phrase is stored only encrypted', async () => {
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    const dump = await dumpStorage(services.storage)

    expect(dump).not.toContain(PHRASE_MARKER)
    expect(dump).not.toContain(TEST_MNEMONIC)
  })

  it('the password is stored nowhere', async () => {
    /* The store holds a verifier block decryptable with the
       password, but not the password itself: otherwise deriving
       a key would be pointless. */
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    expect(await dumpStorage(services.storage)).not.toContain(PASSWORD)
  })

  it('the email address is stored encrypted', async () => {
    /* Personal data that ties the device to a person. */
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)

    expect(await dumpStorage(services.storage)).not.toContain(EMAIL)
  })

  it('value field names are not revealed either', async () => {
    /* An observer must not learn even the record shape: that
       alone hints what to look for. */
    const storage = new InMemoryStorageService()
    const secure = new SecureStorage(storage, new FastEncryptionService())

    await secure.initialize(PASSWORD)
    await secure.set(STORAGE_NAMESPACE.Vault, toStorageKey('probe'), {
      privateKey: '0xdeadbeef',
    })

    const dump = await dumpStorage(storage)

    expect(dump).not.toContain('privateKey')
    expect(dump).not.toContain('deadbeef')
  })

  it('a locked store does not return what was written', async () => {
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
    services.onboarding.lock()

    await expect(
      services.secureStorage.get(STORAGE_NAMESPACE.Vault, VAULT_KEY.Mnemonic),
    ).rejects.toThrow()
  })
})

describe('Secrets do not reach the log', () => {
  it('fields with secret names are replaced by a marker', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('probe', {
        privateKey: '0xdeadbeef',
        mnemonic: TEST_MNEMONIC,
        password: PASSWORD,
        seed: 'something',
      })

      const printed = JSON.stringify(warn.mock.calls)

      expect(printed).not.toContain('deadbeef')
      expect(printed).not.toContain(PHRASE_MARKER)
      expect(printed).not.toContain(PASSWORD)
    } finally {
      warn.mockRestore()
    }
  })

  it('hides an email by the look of the value, not the field name', () => {
    /* The address reaches the log as an account name — under
       `name`, which does not look secret. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('probe', { name: EMAIL })

      expect(JSON.stringify(warn.mock.calls)).not.toContain(EMAIL)
    } finally {
      warn.mockRestore()
    }
  })

  it('truncates a wallet address', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      new ConsoleLogger({ minimumLevel: LOG_LEVEL.Warn }).warn('probe', {
        owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      })

      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('Secrets do not survive state serialization', () => {
  it('a secret buffer is not revealed as a string or as JSON', () => {
    /* Interpolating an object into a template and dumping state
       are the two most common ways to print a key by accident. */
    const secret = SecretBuffer.copyOf(new TextEncoder().encode('very-confidential'))

    try {
      expect(`${secret as unknown as string}`).not.toContain('confidential')
      expect(JSON.stringify({ secret })).not.toContain('confidential')
    } finally {
      secret.wipe()
    }
  })

  it('wiping zeros the bytes, not only marks the buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const secret = SecretBuffer.copyOf(bytes)
    const view = secret.bytes

    secret.wipe()

    expect([...view]).toEqual([0, 0, 0, 0])
  })

  it('a session snapshot contains neither the phrase nor keys', async () => {
    /* The snapshot goes into the React tree and into any debug
       state dump. */
    services.providerFactory.configure({ balance: 0n as Wei })
    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)
    await services.session.open()

    const snapshot = JSON.stringify(services.session.getSnapshot(), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    )

    expect(snapshot).not.toContain(PHRASE_MARKER)
    expect(snapshot).not.toContain(PASSWORD)
  })
})
