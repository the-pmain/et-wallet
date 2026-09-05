import type { ISecretBuffer } from '@/core/encryption'
import type { ISignableTransaction, ISignedTransaction, ITypedData } from '@/core/transaction'
import type { Address, ChainId, HexString } from '@/core/types'

/**
 * Data for signing an arbitrary message.
 *
 * A string is encoded as UTF-8. A byte array is signed as-is.
 * The distinction matters: a dApp may send `0x48656c6c6f` meaning
 * either the bytes `Hello` or that string literally. The domain does
 * not guess — the caller decides by choosing the type.
 */
export type SignableMessage = string | Uint8Array

/**
 * Cryptographic signing.
 *
 * The ONLY place in the app where a private key is used for its
 * purpose. The key is passed as a parameter, not stored, not
 * returned; the caller must wipe the buffer.
 *
 * WHAT THE SERVICE DOES NOT DO: it does not decide whether to sign.
 * Judging the contents — an unlimited token allowance, a recipient
 * on a phishing list, a suspicious amount — is the confirmation
 * layer's job. Here only cryptographic correctness and the checks
 * without which a signature is technically unsafe.
 */
export interface ISigningService {
  /**
   * Signs a transaction.
   *
   * CHECKS RUN BEFORE SIGNING:
   *
   * 1. `chainId` is present and positive. A transaction without
   *    chainId (pre-EIP-155) is valid on ALL EVM networks at once:
   *    a transfer signed on a testnet is replayed on mainnet.
   *
   * 2. The address derived from the key matches `from`. A mismatch
   *    means funds leave an account other than the one shown to the
   *    user.
   *
   * 3. The field set matches the transaction type: `gasPrice` for
   *    legacy, `maxFeePerGas` and `maxPriorityFeePerGas` for
   *    EIP-1559.
   *
   * @throws InvalidArgumentError, AddressChecksumMismatchError
   */
  signTransaction(transaction: ISignableTransaction, privateKey: ISecretBuffer): ISignedTransaction

  /**
   * Signs a message per EIP-191 (`personal_sign`).
   *
   * The prefix `\x19Ethereum Signed Message:\n<length>` is always
   * applied and cannot be turned off. Without it the signed bytes
   * could be a valid serialised transaction, and a signature of a
   * "harmless" message would become a signature of a funds transfer.
   *
   * @returns 65 signature bytes as hex.
   */
  signMessage(message: SignableMessage, privateKey: ISecretBuffer): HexString

  /**
   * Signs structured data (`eth_signTypedData_v4`).
   *
   * More dangerous than a transaction signature: the signed message
   * is presented to a contract later and does not appear in the
   * wallet's operation history.
   *
   * `domain.chainId` is checked against the active network. A
   * structure without a network is rejected: it would be valid on
   * every network at once.
   *
   * @throws InvalidArgumentError on a network mismatch or a broken
   *         structure.
   */
  signTypedData(data: ITypedData, privateKey: ISecretBuffer, expectedChainId: ChainId): HexString

  /**
   * EIP-191 message hash without a signature.
   *
   * Needed by the confirmation screen: the user must be able to
   * compare what is shown with what is signed.
   */
  hashMessage(message: SignableMessage): HexString

  hashTypedData(data: ITypedData): HexString

  /**
   * Recovers the address that signed a message.
   *
   * Used for site login via signature and in tests: a recovered
   * address matching the expected one is the strongest signature
   * check.
   */
  recoverMessageSigner(message: SignableMessage, signature: HexString): Address

  recoverTypedDataSigner(data: ITypedData, signature: HexString): Address
}
