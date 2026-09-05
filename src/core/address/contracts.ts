import type { ISecretBuffer } from '@/core/encryption'
import type { Address } from '@/core/types'

import type { PublicKeyFormat } from './types'

/**
 * Work with EVM addresses.
 *
 * The only place that computes and checks addresses in the app. A
 * second independent implementation is forbidden: two address
 * functions will inevitably diverge, and the wallet will start
 * showing different addresses in different parts of the UI.
 *
 * The service holds no state and has no injected dependencies. It
 * exists as a contract so consumers depend on an abstraction and
 * can swap the implementation in tests, not as a state holder.
 *
 * Primitives used:
 * - secp256k1 — public-key derivation and expanding the compressed form;
 * - Keccak-256 — address and checksum computation;
 * - EIP-55 — encoding the checksum in letter case.
 */
export interface IAddressService {
  /**
   * Parses a string as an address, checking format and checksum.
   *
   * @throws InvalidAddressError, AddressChecksumMismatchError
   */
  parse(value: string): Address

  /** Brings an address to EIP-55 checksum form without checking it. */
  checksum(value: string): Address

  /** Check without throwing. For validation as the user types. */
  isValid(value: string): boolean

  /** Comparison that ignores case. */
  equals(left: string, right: string): boolean

  /** Binary form of the address, 20 bytes. */
  toBytes(address: Address): Uint8Array

  /**
   * Address from 20 bytes.
   *
   * @throws InvalidAddressError on a wrong length.
   */
  fromBytes(bytes: Uint8Array): Address

  /**
   * Address from a public key.
   *
   * Accepts compressed (33 bytes), uncompressed (65 bytes), or raw
   * (64 bytes) SEC1 form.
   *
   * @throws InvalidPublicKeyError
   */
  fromPublicKey(publicKey: Uint8Array): Address

  /**
   * Address from a private key.
   *
   * @throws InvalidPrivateKeyError, SecretBufferWipedError
   */
  fromPrivateKey(privateKey: ISecretBuffer): Address

  /**
   * Public key from a private key.
   *
   * @throws InvalidPrivateKeyError, SecretBufferWipedError
   */
  getPublicKey(privateKey: ISecretBuffer, format?: PublicKeyFormat): Uint8Array

  /**
   * Whether a private key is usable.
   *
   * Not only length is checked, but also the range 1..n-1: a value
   * outside it does not define a point on the curve.
   */
  isValidPrivateKey(privateKey: Uint8Array): boolean

  isZero(address: string): boolean

  /**
   * Whether funds sent to the address are known to be unrecoverable.
   *
   * Does not forbid the send: burning can be intentional. The
   * method's job is to give the UI a reason to warn.
   */
  isBurn(address: string): boolean
}
