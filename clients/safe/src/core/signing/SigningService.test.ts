import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { SecretBuffer, type ISecretBuffer } from '@/core/encryption'
import { InvalidArgumentError, InvalidPrivateKeyError } from '@/core/errors'
import { TRANSACTION_TYPE, type ISignableTransaction, type ITypedData } from '@/core/transaction'
import { toChainId, toWei, type ChainId, type HexString, type Wei } from '@/core/types'

import { SigningService } from './SigningService'
import {
  EIP155_VECTOR,
  EIP712_MAIL,
  EIP712_MAIL_HASH,
  KEY_ONE_ADDRESS,
  KEY_ONE_HEX,
  fromHex,
} from './vectors'

const MAINNET: ChainId = toChainId(1)
const RECIPIENT = toAddress('0x3535353535353535353535353535353535353535')

let service: SigningService
let keyOne: ISecretBuffer

beforeEach(() => {
  service = new SigningService()
  keyOne = SecretBuffer.copyOf(fromHex(KEY_ONE_HEX))
})

function legacyTransaction(overrides: Partial<ISignableTransaction> = {}): ISignableTransaction {
  return {
    type: TRANSACTION_TYPE.Legacy,
    chainId: MAINNET,
    from: KEY_ONE_ADDRESS,
    to: RECIPIENT,
    value: toWei(1),
    data: '0x' as HexString,
    nonce: 0,
    gasLimit: 21_000n,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: 20_000_000_000n,
    ...overrides,
  }
}

function eip1559Transaction(overrides: Partial<ISignableTransaction> = {}): ISignableTransaction {
  return {
    type: TRANSACTION_TYPE.Eip1559,
    chainId: MAINNET,
    from: KEY_ONE_ADDRESS,
    to: RECIPIENT,
    value: toWei(1),
    data: '0x' as HexString,
    nonce: 0,
    gasLimit: 21_000n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    gasPrice: null,
    ...overrides,
  }
}

describe('SigningService: official EIP-155 vector', () => {
  /* The example is given in the standard text. A matching serialised
     transaction confirms the whole chain: RLP encoding, inclusion of
     chainId in the signed data, and formation of `v`. */

  it('produces the reference signed transaction', () => {
    const key = SecretBuffer.copyOf(fromHex(EIP155_VECTOR.privateKeyHex))

    try {
      const signed = service.signTransaction(
        {
          type: TRANSACTION_TYPE.Legacy,
          chainId: EIP155_VECTOR.chainId,
          from: EIP155_VECTOR.from,
          to: EIP155_VECTOR.to,
          value: toWei(EIP155_VECTOR.value),
          data: '0x' as HexString,
          nonce: EIP155_VECTOR.nonce,
          gasLimit: EIP155_VECTOR.gasLimit,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          gasPrice: EIP155_VECTOR.gasPrice,
        },
        key,
      )

      expect(signed.raw).toBe(EIP155_VECTOR.signedRaw)
    } finally {
      key.wipe()
    }
  })
})

describe('SigningService: transaction signing', () => {
  it('signs a legacy transaction', () => {
    const signed = service.signTransaction(legacyTransaction(), keyOne)

    expect(signed.raw).toMatch(/^0xf8/)
    expect(signed.hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('signs an EIP-1559 transaction', () => {
    const signed = service.signTransaction(eip1559Transaction(), keyOne)

    /* EIP-2718 typed-transaction envelope: the first byte is the type code. */
    expect(signed.raw).toMatch(/^0x02/)
  })

  it('returns the original structure unchanged', () => {
    const transaction = eip1559Transaction()
    const signed = service.signTransaction(transaction, keyOne)

    /* What the user was shown and what was signed must match.
       Swapping fields inside signing is the main UI-attack class. */
    expect(signed.transaction).toBe(transaction)
  })

  it('produces different signatures for different nonces', () => {
    const first = service.signTransaction(eip1559Transaction({ nonce: 0 }), keyOne)
    const second = service.signTransaction(eip1559Transaction({ nonce: 1 }), keyOne)

    expect(first.raw).not.toBe(second.raw)
  })

  it('signs a contract deployment', () => {
    const signed = service.signTransaction(eip1559Transaction({ to: null }), keyOne)

    expect(signed.raw).toMatch(/^0x02/)
  })

  it('does not wipe the passed key', () => {
    service.signTransaction(legacyTransaction(), keyOne)

    expect(keyOne.isWiped).toBe(false)
  })
})

describe('SigningService: replay protection', () => {
  /* The main check of the module. A transaction without chainId is
     the pre-EIP-155 format, whose signature is valid on ALL EVM
     networks at once: a transfer signed on a testnet is replayed on
     mainnet. */

  it('rejects a transaction with a zero chainId', () => {
    expect(() =>
      service.signTransaction(legacyTransaction({ chainId: 0n as ChainId }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('rejects a transaction with a negative chainId', () => {
    expect(() =>
      service.signTransaction(legacyTransaction({ chainId: -1n as ChainId }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('includes chainId in the signed data', () => {
    /* The same transaction on different networks must produce
       different signatures. A match would mean no protection. */
    const mainnet = service.signTransaction(legacyTransaction({ chainId: toChainId(1) }), keyOne)
    const polygon = service.signTransaction(legacyTransaction({ chainId: toChainId(137) }), keyOne)

    expect(mainnet.raw).not.toBe(polygon.raw)
  })
})

describe('SigningService: key vs sender check', () => {
  it('rejects a transaction from a foreign address', () => {
    /* Without this check the transaction would be valid but signed
       with the wrong key: funds would leave an account other than
       the one shown to the user. */
    expect(() => service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('names both addresses in the error text', () => {
    expect.assertions(2)

    try {
      service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)
    } catch (error) {
      expect((error as Error).message).toContain(KEY_ONE_ADDRESS)
      expect((error as Error).message).toContain(RECIPIENT)
    }
  })

  it('does not reveal the private key in the error text', () => {
    expect.assertions(1)

    try {
      service.signTransaction(legacyTransaction({ from: RECIPIENT }), keyOne)
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY_ONE_HEX)
    }
  })
})

describe('SigningService: transaction field checks', () => {
  it('requires gasPrice for legacy', () => {
    expect(() => service.signTransaction(legacyTransaction({ gasPrice: null }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('requires fee fields for EIP-1559', () => {
    expect(() =>
      service.signTransaction(eip1559Transaction({ maxFeePerGas: null }), keyOne),
    ).toThrow(InvalidArgumentError)
  })

  it('rejects a priority tip above the overall cap', () => {
    /* The node would reject such a transaction after signing, and the
       user would already have confirmed a fee that does not exist. */
    expect(() =>
      service.signTransaction(
        eip1559Transaction({ maxPriorityFeePerGas: 40_000_000_000n }),
        keyOne,
      ),
    ).toThrow(InvalidArgumentError)
  })

  it('rejects a negative nonce', () => {
    expect(() => service.signTransaction(legacyTransaction({ nonce: -1 }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('rejects a zero gas limit', () => {
    expect(() => service.signTransaction(legacyTransaction({ gasLimit: 0n }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('accepts a zero amount', () => {
    /* A zero-amount transfer is meaningful: that is how a contract is
       called and how a cancellation transaction is formed. */
    expect(() =>
      service.signTransaction(legacyTransaction({ value: toWei(0) }), keyOne),
    ).not.toThrow()
  })

  it('rejects a negative amount passed around the constructor', () => {
    /* `toWei` will not create a negative value, but a type cast
       bypasses the check. A duplicate check before signing is
       justified: the cost of a miss is a transaction whose amount
       becomes a huge positive number when encoded. */
    expect(() => service.signTransaction(legacyTransaction({ value: -1n as Wei }), keyOne)).toThrow(
      InvalidArgumentError,
    )
  })

  it('rejects an unfit private key', () => {
    const zero = SecretBuffer.allocate(32)

    try {
      expect(() => service.signTransaction(legacyTransaction(), zero)).toThrow(
        InvalidPrivateKeyError,
      )
    } finally {
      zero.wipe()
    }
  })
})

describe('SigningService: personal_sign', () => {
  it('signs a string', () => {
    const signature = service.signMessage('Hello, wallet', keyOne)

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/)
  })

  it('recovers the signer address', () => {
    /* The strongest signature check: the recovered address matches
       the expected one. */
    const signature = service.signMessage('Hello, wallet', keyOne)

    expect(service.recoverMessageSigner('Hello, wallet', signature)).toBe(KEY_ONE_ADDRESS)
  })

  it.each(['', 'Hello, wallet', 'I confirm sign-in'])(
    'applies the EIP-191 prefix to message "%s"',
    (message) => {
      /* Without the prefix the signed bytes could be a valid
         serialised transaction, and the signature of a "harmless"
         message would become the signature of a funds transfer.

         The expected value is computed here independently, from the
         standard text: keccak256 of `\x19Ethereum Signed Message:\n<length>`
         and the message itself. Comparing only to the implementation's
         own output would check that it is unchanged, not that it
         matches EIP-191. */
      const payload = utf8ToBytes(message)
      const prefixed = concatBytes(
        utf8ToBytes(`Ethereum Signed Message:\n${String(payload.length)}`),
        payload,
      )

      expect(service.hashMessage(message)).toBe(`0x${bytesToHex(keccak_256(prefixed))}`)
    },
  )

  it('distinguishes messages that differ by a space', () => {
    expect(service.hashMessage('Hello, wallet')).not.toBe(service.hashMessage('Hello, wallet '))
  })

  it('distinguishes a string from bytes of the same shape', () => {
    /* A dApp may send `0x48656c6c6f` meaning either the bytes `Hello`
       or that string literally. The domain does not guess — the caller
       chooses the type, and the results must differ. */
    const asText = service.signMessage('0x48656c6c6f', keyOne)
    const asBytes = service.signMessage(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), keyOne)

    expect(asText).not.toBe(asBytes)
  })

  it('signs an empty message', () => {
    const signature = service.signMessage('', keyOne)

    expect(service.recoverMessageSigner('', signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('signs multi-byte characters', () => {
    const message = 'I confirm sign-in'
    const signature = service.signMessage(message, keyOne)

    expect(service.recoverMessageSigner(message, signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('is deterministic', () => {
    /* RFC 6979 specifies a deterministic signature nonce: resigning
       the same message with the same key must match. A random nonce
       reused reveals the private key. */
    expect(service.signMessage('the same thing', keyOne)).toBe(
      service.signMessage('the same thing', keyOne),
    )
  })

  it('does not recover the address for a changed message', () => {
    const signature = service.signMessage('original', keyOne)

    expect(service.recoverMessageSigner('changed', signature)).not.toBe(KEY_ONE_ADDRESS)
  })
})

describe('SigningService: eth_signTypedData_v4', () => {
  it('produces a hash matching the EIP-712 text example', () => {
    /* The standard gives the final hash for this structure. A match
       confirms encoding correctness independently of the signature. */
    expect(service.hashTypedData(EIP712_MAIL)).toBe(EIP712_MAIL_HASH)
  })

  it('signs a structure and recovers the address', () => {
    const signature = service.signTypedData(EIP712_MAIL, keyOne, MAINNET)

    expect(service.recoverTypedDataSigner(EIP712_MAIL, signature)).toBe(KEY_ONE_ADDRESS)
  })

  it('ignores the EIP712Domain service type in the type set', () => {
    /* The `eth_signTypedData_v4` payload includes this type, but the
       encoder derives the domain from a separate argument and fails
       if it finds it among the others. */
    const withDomainType: ITypedData = {
      ...EIP712_MAIL,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...EIP712_MAIL.types,
      },
    }

    expect(service.hashTypedData(withDomainType)).toBe(EIP712_MAIL_HASH)
  })

  it('does not mutate the original payload', () => {
    const original = JSON.stringify(EIP712_MAIL, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : (value as unknown),
    )

    service.hashTypedData(EIP712_MAIL)

    expect(
      JSON.stringify(EIP712_MAIL, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : (value as unknown),
      ),
    ).toBe(original)
  })
})

describe('SigningService: EIP-712 and network binding', () => {
  /* An EIP-712 signature is bound to a network only through
     domain.chainId. A structure with a foreign value, signed on
     one network, is presented to a contract on another: the user
     is shown "site login", and the signed payload is a Permit
     on mainnet. */

  it('rejects a structure for another network', () => {
    expect(() => service.signTypedData(EIP712_MAIL, keyOne, toChainId(137))).toThrow(
      InvalidArgumentError,
    )
  })

  it('names both networks in the error text', () => {
    expect.assertions(2)

    try {
      service.signTypedData(EIP712_MAIL, keyOne, toChainId(137))
    } catch (error) {
      expect((error as Error).message).toContain('1')
      expect((error as Error).message).toContain('137')
    }
  })

  it('rejects a structure without a network', () => {
    /* A domain without chainId is allowed by the standard, but means
       a signature valid on all networks at once. */
    const withoutChain: ITypedData = {
      ...EIP712_MAIL,
      domain: { name: 'Ether Mail', version: '1' },
    }

    expect(() => service.signTypedData(withoutChain, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('rejects a missing primary type', () => {
    const broken: ITypedData = { ...EIP712_MAIL, primaryType: 'Unknown' }

    expect(() => service.signTypedData(broken, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('rejects an empty primary type', () => {
    const broken: ITypedData = { ...EIP712_MAIL, primaryType: '' }

    expect(() => service.signTypedData(broken, keyOne, MAINNET)).toThrow(InvalidArgumentError)
  })

  it('does not reach cryptography for an unfit structure', () => {
    /* The network check runs before the key is created: an unfit
       structure must never reach cryptography. */
    const zero = SecretBuffer.allocate(32)

    try {
      expect(() => service.signTypedData(EIP712_MAIL, zero, toChainId(137))).toThrow(
        InvalidArgumentError,
      )
    } finally {
      zero.wipe()
    }
  })
})
