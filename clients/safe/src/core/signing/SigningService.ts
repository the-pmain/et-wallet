import {
  Signature,
  SigningKey,
  Transaction,
  hashMessage,
  recoverAddress,
  verifyTypedData,
} from 'ethers'
import { bytesToHex } from '@noble/hashes/utils.js'

import { assertValidPrivateKey, publicKeyToAddress, toAddress } from '@/core/address'
import type { ISecretBuffer } from '@/core/encryption'
import { InvalidArgumentError } from '@/core/errors'
import {
  TRANSACTION_TYPE,
  type ISignableTransaction,
  type ISignedTransaction,
  type ITypedData,
} from '@/core/transaction'
import { toTxHash, type Address, type ChainId, type HexString } from '@/core/types'

import type { ISigningService, SignableMessage } from './contracts'
import {
  assertTypedDataMatchesChain,
  hashTypedData,
  stripDomainType,
  toEthersDomain,
} from './typed-data'

/** Numeric transaction-type codes from EIP-2718. */
const ETHERS_TRANSACTION_TYPE: Readonly<Record<string, number>> = {
  [TRANSACTION_TYPE.Legacy]: 0,
  [TRANSACTION_TYPE.Eip2930]: 1,
  [TRANSACTION_TYPE.Eip1559]: 2,
}

/**
 * Signing of transactions and messages.
 *
 * SERIALISATION IS DONE BY ethers, not homemade code. RLP, EIP-2718
 * typed-transaction envelopes, EIP-712 structure encoding — these are
 * detailed specs, and a mistake in them yields a signature over data
 * other than what the user was shown. A homemade implementation here
 * would be the worst possible choice.
 *
 * THE ELLIPTIC CURVE is ethers `SigningKey`, which uses
 * `@noble/curves`. That is the same library the address module uses:
 * two independent secp256k1 implementations in one app are forbidden.
 */
export class SigningService implements ISigningService {
  signTransaction(
    transaction: ISignableTransaction,
    privateKey: ISecretBuffer,
  ): ISignedTransaction {
    SigningService.#assertSignableTransaction(transaction)

    const signingKey = SigningService.#createSigningKey(privateKey)

    /* The address is derived from the key and checked against `from`.
       Without this check the transaction would be valid but signed
       with the wrong key — funds would leave an account other than
       the one shown to the user, and that cannot be undone. */
    SigningService.#assertKeyMatchesSender(signingKey, transaction.from)

    const unsigned = toEthersTransaction(transaction)
    const signature = signingKey.sign(unsigned.unsignedHash)

    unsigned.signature = signature

    return {
      raw: unsigned.serialized as HexString,
      hash: toTxHash(unsigned.hash),
      transaction,
    }
  }

  signMessage(message: SignableMessage, privateKey: ISecretBuffer): HexString {
    const signingKey = SigningService.#createSigningKey(privateKey)

    return signingKey.sign(hashMessage(message)).serialized as HexString
  }

  signTypedData(data: ITypedData, privateKey: ISecretBuffer, expectedChainId: ChainId): HexString {
    /* The network is checked BEFORE the key is created: an unfit
       structure must not reach cryptography at all. */
    assertTypedDataMatchesChain(data, expectedChainId)

    const signingKey = SigningService.#createSigningKey(privateKey)

    return signingKey.sign(hashTypedData(data)).serialized as HexString
  }

  hashMessage(message: SignableMessage): HexString {
    return hashMessage(message) as HexString
  }

  hashTypedData(data: ITypedData): HexString {
    return hashTypedData(data)
  }

  recoverMessageSigner(message: SignableMessage, signature: HexString): Address {
    return toAddress(recoverAddress(hashMessage(message), Signature.from(signature)))
  }

  recoverTypedDataSigner(data: ITypedData, signature: HexString): Address {
    return toAddress(
      verifyTypedData(
        toEthersDomain(data.domain),
        stripDomainType(data.types) as Record<string, { name: string; type: string }[]>,
        data.message as Record<string, unknown>,
        signature,
      ),
    )
  }

  /**
   * Validates a transaction before signing.
   *
   * A refusal here is always preferable to a signature: a signed
   * transaction is irreversible, and the user can fix a refusal.
   */
  static #assertSignableTransaction(transaction: ISignableTransaction): void {
    /* THE MOST IMPORTANT CHECK IN THE MODULE. A transaction without
       chainId is the pre-EIP-155 format, whose signature is valid on
       every EVM network at once. A transfer signed on a testnet is
       replayed by an attacker on mainnet with the same parameters. */
    if (transaction.chainId <= 0n) {
      throw new InvalidArgumentError(
        'transaction.chainId',
        'a transaction without a chain identifier is valid in every network at once',
      )
    }

    if (!Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0) {
      throw new InvalidArgumentError('transaction.nonce', 'a non-negative integer is expected')
    }

    if (transaction.gasLimit <= 0n) {
      throw new InvalidArgumentError('transaction.gasLimit', 'the gas limit must be positive')
    }

    if (transaction.value < 0n) {
      throw new InvalidArgumentError('transaction.value', 'the amount cannot be negative')
    }

    SigningService.#assertFeeFieldsMatchType(transaction)
  }

  /**
   * Checks that fee fields match the transaction type.
   *
   * Mixed fields mean the caller has not decided the type. Silently
   * choosing for them is forbidden: the node would reject a
   * transaction with the wrong field set after signing, and the user
   * would see an opaque refusal instead of a clear message.
   */
  static #assertFeeFieldsMatchType(transaction: ISignableTransaction): void {
    if (transaction.type === TRANSACTION_TYPE.Eip1559) {
      if (transaction.maxFeePerGas === null || transaction.maxPriorityFeePerGas === null) {
        throw new InvalidArgumentError(
          'transaction.maxFeePerGas',
          'an EIP-1559 transaction requires maxFeePerGas and maxPriorityFeePerGas',
        )
      }

      if (transaction.maxPriorityFeePerGas > transaction.maxFeePerGas) {
        /* The priority tip cannot exceed the overall cap: the node
           would reject the transaction, and the user would already
           have confirmed a fee that does not exist. */
        throw new InvalidArgumentError(
          'transaction.maxPriorityFeePerGas',
          'the priority fee cannot exceed maxFeePerGas',
        )
      }

      return
    }

    if (transaction.gasPrice === null) {
      throw new InvalidArgumentError(
        'transaction.gasPrice',
        `a transaction of type "${transaction.type}" requires gasPrice`,
      )
    }
  }

  /**
   * Checks the key address against the transaction sender.
   *
   * @throws InvalidArgumentError on a mismatch. The message contains
   *         neither the key nor its derivatives except the public
   *         address.
   */
  static #assertKeyMatchesSender(signingKey: SigningKey, from: Address): void {
    const derived = publicKeyToAddress(SigningService.#hexToBytes(signingKey.publicKey))

    if (derived !== from) {
      throw new InvalidArgumentError(
        'transaction.from',
        `the key belongs to ${derived}, while the transaction is sent from ${from}`,
      )
    }
  }

  /**
   * Creates a signing key from a buffer.
   *
   * The range is checked before handing to ethers: a value outside
   * 1..n-1 does not define a curve point, and a clear error is better
   * than an internal library error.
   */
  static #createSigningKey(privateKey: ISecretBuffer): SigningKey {
    const bytes = privateKey.bytes

    assertValidPrivateKey(bytes)

    return new SigningKey(`0x${bytesToHex(bytes)}`)
  }

  static #hexToBytes(value: string): Uint8Array {
    const body = value.startsWith('0x') ? value.slice(2) : value
    const bytes = new Uint8Array(body.length / 2)

    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
    }

    return bytes
  }
}

/**
 * Builds an ethers transaction from the domain structure.
 *
 * LIFTED OUT OF THE CLASS because hardware signing uses the same
 * conversion: it needs the same bytes that go into the signature
 * here. Two conversions would mean two views of one transaction, and
 * they could diverge silently.
 */
export function toEthersTransaction(transaction: ISignableTransaction): Transaction {
  const type = ETHERS_TRANSACTION_TYPE[transaction.type]

  if (type === undefined) {
    throw new InvalidArgumentError('transaction.type', `unknown type "${transaction.type}"`)
  }

  return Transaction.from({
    type,
    chainId: transaction.chainId,
    to: transaction.to,
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit,
    value: transaction.value,
    data: transaction.data,
    ...(transaction.gasPrice === null ? {} : { gasPrice: transaction.gasPrice }),
    ...(transaction.maxFeePerGas === null ? {} : { maxFeePerGas: transaction.maxFeePerGas }),
    ...(transaction.maxPriorityFeePerGas === null
      ? {}
      : { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }),
  })
}
