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

const PASSWORD = 'correct-password-1234'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Private key equal to one. Its address is well known. */
const IMPORTED_KEY = new Uint8Array(32)
IMPORTED_KEY[31] = 1
const IMPORTED_ADDRESS = toAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')

/** Second key to check re-import of another address. */
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
 * Permit to export an imported key.
 *
 * The scope is own to each imported key, not the HD-account path.
 * Otherwise revealing an imported key would mark the HD account
 * compromised, though the two secrets are not related.
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

describe('AccountManager: initialisation', () => {
  it('refuses list access before init()', () => {
    const fresh = AccountManager.create({ hdWallet, secureStorage: secure, clock, logger })

    expect(() => fresh.list()).toThrow(NotInitializedError)
  })

  it('starts with an empty list', () => {
    expect(manager.list()).toHaveLength(0)
    expect(manager.getActive()).toBeNull()
  })

  it('is idempotent on a second call', async () => {
    await manager.create()
    await manager.init()

    expect(manager.list()).toHaveLength(1)
  })

  it('restores accounts after recreation', async () => {
    await manager.create()
    await manager.create({ name: 'Second' })

    const restored = await createManager()

    expect(restored.list()).toHaveLength(2)
    expect(restored.list()[1]?.name).toBe('Second')
  })
})

describe('AccountManager: creating accounts', () => {
  it('creates an account with an address from the HD tree', async () => {
    const account = await manager.create()

    expect(account.address).toBe(hdWallet.getAddress(0))
    expect(account.source).toBe(KEYRING_TYPE.Hd)
    expect(account.addressIndex).toBe(0)
    expect(account.derivationPath).toBe("m/44'/60'/0'/0/0")
  })

  it('assigns a default name', async () => {
    expect((await manager.create()).name).toBe('Account 1')
    expect((await manager.create()).name).toBe('Account 2')
  })

  it('accepts a given name', async () => {
    expect((await manager.create({ name: '  Payroll  ' })).name).toBe('Payroll')
  })

  it('increments the address index', async () => {
    await manager.create()
    const second = await manager.create()

    expect(second.addressIndex).toBe(1)
    expect(second.address).toBe(hdWallet.getAddress(1))
  })

  it('does not reuse an index after hiding an account', async () => {
    /* The index is taken as the maximum plus one, not as the
       account count: counting by quantity after hiding would reuse
       an index, i.e. two accounts with one address. */
    const first = await manager.create()
    await manager.create()
    await manager.setHidden(first.id, false)
    await manager.setActive((manager.list()[1] as { id: AccountId }).id)
    await manager.setHidden(first.id, true)

    expect((await manager.create()).addressIndex).toBe(2)
  })

  it('makes the first created account active', async () => {
    const account = await manager.create()

    expect(manager.getActive()?.id).toBe(account.id)
  })

  it('does not change the active one when later ones are created', async () => {
    const first = await manager.create()
    await manager.create()

    expect(manager.getActive()?.id).toBe(first.id)
  })

  it('emits a list-changed event', async () => {
    const listener = vi.fn()
    manager.on('account:listChanged', listener)

    await manager.create()

    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not contain a private key in the account structure', async () => {
    const account = await manager.create()

    expect(JSON.stringify(account)).not.toContain('privateKey')
  })
})

describe('AccountManager: private-key import', () => {
  it('imports a key and derives the address', async () => {
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

  it('does not wipe the passed buffer', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      await manager.importPrivateKey({ privateKey: key })

      expect(key.isWiped).toBe(false)
    } finally {
      key.wipe()
    }
  })

  it('rejects a second import of the same address', async () => {
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

  it('rejects an unfit key', async () => {
    const zero = SecretBuffer.allocate(32)

    try {
      await expect(manager.importPrivateKey({ privateKey: zero })).rejects.toThrow(
        InvalidPrivateKeyError,
      )
    } finally {
      zero.wipe()
    }
  })

  it('does not save an unfit key in storage', async () => {
    const zero = SecretBuffer.allocate(32)

    try {
      await expect(manager.importPrivateKey({ privateKey: zero })).rejects.toThrow()

      expect(manager.list()).toHaveLength(0)
    } finally {
      zero.wipe()
    }
  })

  it('does not store an imported key in the clear', async () => {
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

  it('gives imported accounts different key sets', async () => {
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

describe('AccountManager: renaming', () => {
  let accountId: AccountId

  beforeEach(async () => {
    accountId = (await manager.create()).id
  })

  it('changes the name', async () => {
    await manager.rename(accountId, 'Primary')

    expect(manager.getById(accountId)?.name).toBe('Primary')
  })

  it('trims spaces and collapses repeats', async () => {
    await manager.rename(accountId, '  My   account   ')

    expect(manager.getById(accountId)?.name).toBe('My account')
  })

  it('strips control characters', async () => {
    /* A newline in the name breaks the list layout and lets a
       neighbouring row be visually forged. */
    await manager.rename(accountId, 'Name\nFake string')

    expect(manager.getById(accountId)?.name).toBe('NameFake string')
  })

  it('rejects an empty name', async () => {
    await expect(manager.rename(accountId, '   ')).rejects.toThrow(InvalidArgumentError)
  })

  it('rejects a too-long name', async () => {
    await expect(
      manager.rename(accountId, 'a'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1)),
    ).rejects.toThrow(InvalidArgumentError)
  })

  it('rejects a missing account', async () => {
    await expect(manager.rename('0'.repeat(32) as AccountId, 'Name')).rejects.toThrow(
      AccountNotFoundError,
    )
  })

  it('keeps the name across sessions', async () => {
    await manager.rename(accountId, 'Saved')

    expect((await createManager()).getById(accountId)?.name).toBe('Saved')
  })
})

describe('AccountManager: choosing the active one', () => {
  it('changes the active account', async () => {
    await manager.create()
    const second = await manager.create()

    await manager.setActive(second.id)

    expect(manager.getActive()?.id).toBe(second.id)
  })

  it('emits an active-changed event', async () => {
    await manager.create()
    const second = await manager.create()

    const listener = vi.fn()
    manager.on('account:activeChanged', listener)
    await manager.setActive(second.id)

    expect(listener).toHaveBeenCalledExactlyOnceWith({ address: second.address })
  })

  it('does not emit an event when the already active one is chosen', async () => {
    const first = await manager.create()

    const listener = vi.fn()
    manager.on('account:activeChanged', listener)
    await manager.setActive(first.id)

    expect(listener).not.toHaveBeenCalled()
  })

  it('refuses choosing a hidden account', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setHidden(second.id, true)

    await expect(manager.setActive(second.id)).rejects.toThrow(InvalidArgumentError)
  })

  it('restores the choice across sessions', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setActive(second.id)

    expect((await createManager()).getActive()?.id).toBe(second.id)
  })
})

describe('AccountManager: hiding', () => {
  it('hides an account', async () => {
    await manager.create()
    const second = await manager.create()

    await manager.setHidden(second.id, true)

    expect(manager.listVisible()).toHaveLength(1)
    expect(manager.list()).toHaveLength(2)
  })

  it('restores a hidden account', async () => {
    await manager.create()
    const second = await manager.create()
    await manager.setHidden(second.id, true)
    await manager.setHidden(second.id, false)

    expect(manager.listVisible()).toHaveLength(2)
  })

  it('refuses hiding the active account', async () => {
    const first = await manager.create()
    await manager.create()

    await expect(manager.setHidden(first.id, true)).rejects.toThrow(InvalidArgumentError)
  })

  it('refuses hiding the last visible one', async () => {
    const only = await manager.create()

    await expect(manager.setHidden(only.id, true)).rejects.toThrow(InvalidArgumentError)
  })
})

describe('AccountManager: removal', () => {
  it('refuses removing an account from the HD tree', async () => {
    /* An account derived from the seed phrase will reappear on
       the next wallet restore. A “delete” button that only hides
       the record misleads the user. */
    const account = await manager.create()

    await expect(manager.remove(account.id, PASSWORD)).rejects.toThrow(AccountNotRemovableError)
  })

  it('removes an imported account', async () => {
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

  it('removes the private key with it', async () => {
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

  it('requires a password', async () => {
    await manager.create()
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })

      await expect(manager.remove(imported.id, 'wrong')).rejects.toThrow(InvalidPasswordError)
      expect(manager.getById(imported.id)).not.toBeNull()
    } finally {
      key.wipe()
    }
  })

  it('switches the active account when the active one is removed', async () => {
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

  it('refuses removing the only account', async () => {
    const key = SecretBuffer.copyOf(IMPORTED_KEY)

    try {
      const imported = await manager.importPrivateKey({ privateKey: key })

      await expect(manager.remove(imported.id, PASSWORD)).rejects.toThrow(InvalidArgumentError)
    } finally {
      key.wipe()
    }
  })
})

describe('AccountManager: display order', () => {
  it('changes the order', async () => {
    const first = await manager.create()
    const second = await manager.create()

    await manager.reorder([second.id, first.id])

    expect(manager.list().map((account) => account.id)).toEqual([second.id, first.id])
  })

  it('rejects an incomplete list', async () => {
    const first = await manager.create()
    await manager.create()

    await expect(manager.reorder([first.id])).rejects.toThrow(InvalidArgumentError)
  })

  it('keeps the order across sessions', async () => {
    const first = await manager.create()
    const second = await manager.create()
    await manager.reorder([second.id, first.id])

    expect((await createManager()).list()[0]?.id).toBe(second.id)
  })
})

describe('AccountManager: private-key export', () => {
  it('reveals an HD-account key', async () => {
    const account = await manager.create()
    const key = await manager.exportPrivateKey(account.id, PASSWORD, await permitForHd(0))

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('reveals an imported-account key unchanged', async () => {
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

  it('requires a password even when the lock is off', async () => {
    /* An unlocked lock only means the password was entered at
       some point, not that the owner is at the device now. */
    const account = await manager.create()

    await expect(
      manager.exportPrivateKey(account.id, 'wrong', await permitForHd(0)),
    ).rejects.toThrow(InvalidPasswordError)
  })

  it('requires a permit that matches the operation', async () => {
    const account = await manager.create()
    const wrongPermit = await guard.confirm(
      privateKeyExportRequest(hdAccountScope(hdWallet.accountPath), 5),
      EXPORT_RISK.Critical,
    )

    await expect(manager.exportPrivateKey(account.id, PASSWORD, wrongPermit)).rejects.toThrow(
      ExportNotPermittedError,
    )
  })

  it('consumes the permit after use', async () => {
    const account = await manager.create()
    const permit = await permitForHd(0)

    ;(await manager.exportPrivateKey(account.id, PASSWORD, permit)).wipe()

    expect(permit.isConsumed).toBe(true)
  })

  it('records the export in the log', async () => {
    const account = await manager.create()

    ;(await manager.exportPrivateKey(account.id, PASSWORD, await permitForHd(0))).wipe()

    await expect(guard.getHistory(hdAccountScope(hdWallet.accountPath))).resolves.toHaveLength(1)
  })

  it('detects a dangerous combination with a previously issued xpub', async () => {
    /* An xpub plus the private key of any descendant disclose the
       whole account. The second export must get the “account
       compromise” level. */
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

  it('rejects a missing account', async () => {
    await expect(
      manager.exportPrivateKey('0'.repeat(32) as AccountId, PASSWORD, await permitForHd(0)),
    ).rejects.toThrow(AccountNotFoundError)
  })
})

describe('AccountManager: lookup', () => {
  it('finds an account by address case-insensitively', async () => {
    const account = await manager.create()

    expect(manager.getByAddress(account.address.toLowerCase() as typeof account.address)?.id).toBe(
      account.id,
    )
  })

  it('returns null for a foreign address', async () => {
    await manager.create()

    expect(manager.getByAddress(IMPORTED_ADDRESS)).toBeNull()
  })
})
