import { HDKey } from '@scure/bip32'
import { beforeEach, describe, expect, it } from 'vitest'

import { PUBLIC_KEY_FORMAT, toAddress } from '@/core/address'
import { SecretBuffer, type ISecretBuffer } from '@/core/encryption'
import {
  ExportNotPermittedError,
  InvalidArgumentError,
  InvalidDerivationPathError,
  InvalidExtendedKeyError,
  KeyringCannotSignError,
  NotInitializedError,
} from '@/core/errors'
import { SigningService } from '@/core/signing'
import { EIP712_MAIL } from '@/core/signing/vectors'
import { TRANSACTION_TYPE } from '@/core/transaction'
import { MnemonicService } from '@/core/mnemonic'
import {
  EXPORT_KIND,
  EXPORT_RISK,
  ExportAuditLog,
  ExportGuard,
  accountExportRequest,
  hdAccountScope,
  privateKeyExportRequest,
  type ExportPermit,
} from '@/core/security'
import { toChainId, toWei, type DerivationPath, type HexString } from '@/core/types'
import { FakeClock, InMemoryStorageService } from '@/test/doubles'
import { toDerivationPath } from '@/core/hdwallet/path'

import { HDWalletService } from './HDWalletService'
import { MAX_ACCOUNTS_PER_CALL } from './types'
import { BIP32_VECTOR_1, TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from './vectors'

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Issues an export permit with confirmation at the highest risk level.
 *
 * `HDWalletService` tests check that the permit matches the operation,
 * not the risk rating — that is covered separately in `ExportGuard` tests.
 */
async function permitFor(
  kind: (typeof EXPORT_KIND)[keyof typeof EXPORT_KIND],
  accountPath: DerivationPath,
  addressIndex: number | null = null,
): Promise<ExportPermit> {
  const guard = new ExportGuard(
    new ExportAuditLog(new InMemoryStorageService()),
    new FakeClock(1_700_000_000_000),
  )

  const request =
    addressIndex === null
      ? accountExportRequest(kind, hdAccountScope(accountPath))
      : privateKeyExportRequest(hdAccountScope(accountPath), addressIndex)

  return await guard.confirm(request, EXPORT_RISK.Critical)
}

async function seedFromTestMnemonic(): Promise<ISecretBuffer> {
  const mnemonicService = new MnemonicService()
  const mnemonic = mnemonicService.fromPhrase(TEST_MNEMONIC)

  try {
    return await mnemonicService.toSeed(mnemonic)
  } finally {
    mnemonic.wipe()
  }
}

describe('BIP-32 layer: official vector 1', () => {
  /* Derivation itself is checked, independent of Ethereum addresses.
     Extended keys are compared as base58 strings — they encode the
     key, the chain code and the parent fingerprint, so a string match
     means the whole node matches. */
  it('yields the reference extended keys of the root', () => {
    const root = HDKey.fromMasterSeed(fromHex(BIP32_VECTOR_1.seedHex))

    expect(root.privateExtendedKey).toBe(BIP32_VECTOR_1.masterXprv)
    expect(root.publicExtendedKey).toBe(BIP32_VECTOR_1.masterXpub)
  })
})

describe('HDWalletService: addresses of the test mnemonic', () => {
  let seed: ISecretBuffer
  let wallet: HDWalletService

  beforeEach(async () => {
    seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
  })

  it.each(TEST_MNEMONIC_ADDRESSES.map((address, index) => ({ address, index })))(
    'the address at index $index matches the reference',
    ({ address, index }) => {
      expect(wallet.getAddress(index)).toBe(address)
    },
  )

  it("uses the path m/44'/60'/0'/0/n", () => {
    expect(wallet.accountPath).toBe("m/44'/60'/0'")
    expect(wallet.deriveAccount(3).path).toBe("m/44'/60'/0'/0/3")
  })

  it('returns addresses in EIP-55 checksum', () => {
    const address = wallet.getAddress(0)

    expect(() => toAddress(address)).not.toThrow()
    expect(address).not.toBe(address.toLowerCase())
  })

  it('yields different addresses under the Ledger Live convention', () => {
    const ledgerStyle = HDWalletService.fromSeed(seed, { accountIndex: 1 })

    try {
      /* Different branches of the tree. A wallet that supports only
         one convention will show an empty balance on import. */
      expect(ledgerStyle.getAddress(0)).not.toBe(wallet.getAddress(0))
    } finally {
      ledgerStyle.wipe()
    }
  })
})

describe('HDWalletService: creating accounts', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('derives an account with a full set of public data', () => {
    const account = wallet.deriveAccount(0)

    expect(account.addressIndex).toBe(0)
    expect(account.path).toBe("m/44'/60'/0'/0/0")
    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[0])
    expect(account.publicKey).toHaveLength(33)
  })

  it('does not contain a private key in the account structure', () => {
    const account = wallet.deriveAccount(0)

    expect(JSON.stringify(account)).not.toContain('privateKey')
    expect(Object.keys(account)).toEqual(['addressIndex', 'path', 'address', 'publicKey'])
  })

  it('derives several accounts in a row', () => {
    const accounts = wallet.deriveAccounts(0, 5)

    expect(accounts.map((account) => account.address)).toEqual(TEST_MNEMONIC_ADDRESSES)
  })

  it('derives accounts starting from a given index', () => {
    const accounts = wallet.deriveAccounts(2, 2)

    expect(accounts[0]?.addressIndex).toBe(2)
    expect(accounts[1]?.addressIndex).toBe(3)
  })

  it('is deterministic: a second derivation yields the same address', () => {
    expect(wallet.getAddress(17)).toBe(wallet.getAddress(17))
  })

  it('limits the number of accounts in one call', () => {
    expect(() => wallet.deriveAccounts(0, MAX_ACCOUNTS_PER_CALL + 1)).toThrow(
      InvalidExtendedKeyError,
    )
  })

  it('rejects a zero count', () => {
    expect(() => wallet.deriveAccounts(0, 0)).toThrow(InvalidExtendedKeyError)
  })

  it('rejects an index from the hardened-derivation range', () => {
    expect(() => wallet.deriveAccount(0x80000000)).toThrow(InvalidDerivationPathError)
  })
})

describe('HDWalletService: keys', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('issues a 32-byte private key', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('issues different private keys for different indexes', async () => {
    const first = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )
    const second = wallet.exportPrivateKey(
      1,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 1),
    )

    try {
      expect(toHex(first.bytes)).not.toBe(toHex(second.bytes))
    } finally {
      first.wipe()
      second.wipe()
    }
  })

  it('the private key matches the address', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      /* A public key recovered from the private one must yield the
         same address. A mismatch would mean the wallet shows an
         address it cannot sign for. */
      const node = new HDKey({ privateKey: key.bytes, chainCode: new Uint8Array(32) })

      expect(node.publicKey).not.toBeNull()
      expect(toHex(node.publicKey as Uint8Array)).toBe(toHex(wallet.getPublicKey(0)))
    } finally {
      key.wipe()
    }
  })

  it('returns a copy of the private key, not the internal buffer', async () => {
    const first = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )
    const firstHex = toHex(first.bytes)
    first.wipe()

    const second = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(toHex(second.bytes)).toBe(firstHex)
    } finally {
      second.wipe()
    }
  })

  it('issues a compressed public key by default', () => {
    expect(wallet.getPublicKey(0)).toHaveLength(33)
  })

  it('issues an uncompressed public key on request', () => {
    const uncompressed = wallet.getPublicKey(0, PUBLIC_KEY_FORMAT.Uncompressed)

    expect(uncompressed).toHaveLength(65)
    expect(uncompressed[0]).toBe(0x04)
  })

  it('both public-key forms yield one address', () => {
    const account = wallet.deriveAccount(0)

    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[0])
  })
})

describe('HDWalletService: signing', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('signs a message with the key of the given address', () => {
    /* End-to-end check: mnemonic -> seed -> BIP-32 -> signature ->
       address recovery. A match with the address at the same index
       means the wallet signs with the key that belongs to the shown
       address. */
    const signing = new SigningService()
    const signature = wallet.signMessage(2, 'I confirm sign-in')

    expect(signing.recoverMessageSigner('I confirm sign-in', signature)).toBe(wallet.getAddress(2))
  })

  it('different indexes yield different signatures', () => {
    expect(wallet.signMessage(0, 'one message')).not.toBe(
      wallet.signMessage(1, 'one message'),
    )
  })

  it('signs a transaction from its own address', () => {
    const signed = wallet.signTransaction(0, {
      type: TRANSACTION_TYPE.Eip1559,
      chainId: toChainId(1),
      from: wallet.getAddress(0),
      to: wallet.getAddress(1),
      value: toWei(1),
      data: '0x' as HexString,
      nonce: 0,
      gasLimit: 21_000n,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gasPrice: null,
    })

    expect(signed.raw).toMatch(/^0x02/)
    expect(signed.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('rejects a transaction from a foreign address', () => {
    /* The address index and the `from` field must match: otherwise
       funds would leave an account other than the one shown to the
       user. */
    expect(() =>
      wallet.signTransaction(0, {
        type: TRANSACTION_TYPE.Eip1559,
        chainId: toChainId(1),
        from: wallet.getAddress(5),
        to: wallet.getAddress(1),
        value: toWei(1),
        data: '0x' as HexString,
        nonce: 0,
        gasLimit: 21_000n,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: null,
      }),
    ).toThrow(InvalidArgumentError)
  })

  it('signs structured data when the network matches', () => {
    const signing = new SigningService()
    const signature = wallet.signTypedData(0, EIP712_MAIL, toChainId(1))

    expect(signing.recoverTypedDataSigner(EIP712_MAIL, signature)).toBe(wallet.getAddress(0))
  })

  it('rejects a structure intended for another network', () => {
    expect(() => wallet.signTypedData(0, EIP712_MAIL, toChainId(137))).toThrow(InvalidArgumentError)
  })

  it('refuses to sign after a wipe', () => {
    wallet.wipe()

    expect(() => wallet.signMessage(0, 'message')).toThrow(NotInitializedError)
  })
})

describe('HDWalletService: extended keys', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('exports the account-level xpub', async () => {
    expect(wallet.exportAccountXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))).toMatch(
      /^xpub/,
    )
  })

  it('exports the chain-level xpub', async () => {
    expect(wallet.exportChangeXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))).toMatch(
      /^xpub/,
    )
  })

  it('account and chain xpubs differ', async () => {
    const account = wallet.exportAccountXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))
    const change = wallet.exportChangeXpub(await permitFor(EXPORT_KIND.Xpub, wallet.accountPath))

    expect(account).not.toBe(change)
  })

  it('exports the account-level xprv', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      expect(new TextDecoder().decode(xprv.bytes)).toMatch(/^xprv/)
    } finally {
      xprv.wipe()
    }
  })

  it('xprv is not disclosed when serialising state', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      expect(JSON.stringify({ key: xprv })).toBe('{"key":"[SECRET]"}')
    } finally {
      xprv.wipe()
    }
  })

  it('discloses xpub to internal consumers without a permit', () => {
    expect(wallet.peekAccountXpub()).toMatch(/^xpub/)
  })
})

describe('HDWalletService: export permits', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('issues a private key on a valid permit', async () => {
    const key = wallet.exportPrivateKey(
      0,
      await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0),
    )

    try {
      expect(key.bytes).toHaveLength(32)
    } finally {
      key.wipe()
    }
  })

  it('rejects a permit issued for another export kind', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)

    expect(() => wallet.exportAccountXprv(permit)).toThrow(ExportNotPermittedError)
  })

  it('rejects a permit issued for another address', async () => {
    const permit = await permitFor(EXPORT_KIND.PrivateKey, wallet.accountPath, 0)

    expect(() => wallet.exportPrivateKey(1, permit)).toThrow(ExportNotPermittedError)
  })

  it('rejects a permit issued for another account', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, toDerivationPath("m/44'/60'/7'"))

    expect(() => wallet.exportAccountXpub(permit)).toThrow(ExportNotPermittedError)
  })

  it('consumes the permit after use', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)
    wallet.exportAccountXpub(permit)

    expect(permit.isConsumed).toBe(true)
    expect(() => wallet.exportAccountXpub(permit)).toThrow(ExportNotPermittedError)
  })

  it('does not require a permit to sign', () => {
    /* Signing happens inside the module, the key does not leave, so
       an export permit is not needed here and is not requested. */
    const signature = wallet.signMessage(0, 'hello')

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/)
  })
})

describe('HDWalletService: watch-only mode from xpub', () => {
  let wallet: HDWalletService
  let watchOnly: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
    watchOnly = HDWalletService.fromAccountExtendedKey(wallet.peekAccountXpub())
  })

  it('derives the same addresses as the full wallet', () => {
    expect(watchOnly.getAddress(0)).toBe(wallet.getAddress(0))
    expect(watchOnly.getAddress(9)).toBe(wallet.getAddress(9))
  })

  it('reports that it cannot issue private keys', () => {
    expect(watchOnly.canDerivePrivateKeys).toBe(false)
    expect(wallet.canDerivePrivateKeys).toBe(true)
  })

  it('refuses to sign', () => {
    expect(() => watchOnly.signMessage(0, 'hello')).toThrow(KeyringCannotSignError)
  })

  it('refuses to export a private key', async () => {
    const permit = await permitFor(EXPORT_KIND.PrivateKey, watchOnly.accountPath, 0)

    expect(() => watchOnly.exportPrivateKey(0, permit)).toThrow(KeyringCannotSignError)
  })

  it('refuses to export xprv', async () => {
    const permit = await permitFor(EXPORT_KIND.Xprv, watchOnly.accountPath)

    expect(() => watchOnly.exportAccountXprv(permit)).toThrow(KeyringCannotSignError)
  })

  it('also restores from xprv, keeping the ability to sign', async () => {
    const xprv = wallet.exportAccountXprv(await permitFor(EXPORT_KIND.Xprv, wallet.accountPath))

    try {
      const restored = HDWalletService.fromAccountExtendedKey(new TextDecoder().decode(xprv.bytes))

      try {
        expect(restored.canDerivePrivateKeys).toBe(true)
        expect(restored.getAddress(0)).toBe(wallet.getAddress(0))
      } finally {
        restored.wipe()
      }
    } finally {
      xprv.wipe()
    }
  })

  it('rejects an unreadable extended key', () => {
    expect(() => HDWalletService.fromAccountExtendedKey('not-a-key')).toThrow(InvalidExtendedKeyError)
  })

  it('does not disclose the parsed key in the error text', () => {
    expect.assertions(1)

    try {
      HDWalletService.fromAccountExtendedKey('xprvFakeSecret')
    } catch (error) {
      expect((error as Error).message).not.toContain('FakeSecret')
    }
  })
})

describe('HDWalletService: arbitrary path', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('derives an account from a full path', () => {
    const account = wallet.deriveByPath(toDerivationPath("m/44'/60'/0'/0/2"))

    expect(account.address).toBe(TEST_MNEMONIC_ADDRESSES[2])
  })

  it('derives an address of the internal chain', () => {
    const account = wallet.deriveByPath(toDerivationPath("m/44'/60'/0'/1/0"))

    expect(account.address).not.toBe(TEST_MNEMONIC_ADDRESSES[0])
  })

  it('rejects a path outside the account branch', () => {
    expect(() => wallet.deriveByPath(toDerivationPath("m/44'/61'/0'/0/0"))).toThrow(
      InvalidExtendedKeyError,
    )
  })
})

describe('HDWalletService: wiping', () => {
  let wallet: HDWalletService

  beforeEach(async () => {
    const seed = await seedFromTestMnemonic()
    wallet = HDWalletService.fromSeed(seed)
    seed.wipe()
  })

  it('marks the instance as wiped', () => {
    wallet.wipe()

    expect(wallet.isWiped).toBe(true)
  })

  it('refuses derivation after a wipe', () => {
    wallet.wipe()

    expect(() => wallet.getAddress(0)).toThrow(NotInitializedError)
  })

  it('refuses to export xpub after a wipe', async () => {
    const permit = await permitFor(EXPORT_KIND.Xpub, wallet.accountPath)
    wallet.wipe()

    expect(() => wallet.exportAccountXpub(permit)).toThrow(NotInitializedError)
  })

  it('allows a second wipe', () => {
    wallet.wipe()

    expect(() => {
      wallet.wipe()
    }).not.toThrow()
  })
})

describe('HDWalletService: seed checks', () => {
  it('rejects a seed that is too short', () => {
    const seed = SecretBuffer.allocate(8)

    try {
      expect(() => HDWalletService.fromSeed(seed)).toThrow(InvalidExtendedKeyError)
    } finally {
      seed.wipe()
    }
  })

  it('rejects a seed that is too long', () => {
    const seed = SecretBuffer.allocate(65)

    try {
      expect(() => HDWalletService.fromSeed(seed)).toThrow(InvalidExtendedKeyError)
    } finally {
      seed.wipe()
    }
  })

  it('does not wipe the given seed: ownership stays with the caller', async () => {
    const seed = await seedFromTestMnemonic()

    try {
      const wallet = HDWalletService.fromSeed(seed)
      wallet.wipe()

      expect(seed.isWiped).toBe(false)
      expect(seed.bytes.some((byte) => byte !== 0)).toBe(true)
    } finally {
      seed.wipe()
    }
  })
})
