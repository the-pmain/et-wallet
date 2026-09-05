import { secp256k1 } from '@noble/curves/secp256k1.js'

import type { ISecretBuffer } from '@/core/encryption'
import { InvalidPrivateKeyError } from '@/core/errors'
import type { Address } from '@/core/types'

import { publicKeyToAddress } from './Address'
import { PRIVATE_KEY_LENGTH, PUBLIC_KEY_FORMAT, type PublicKeyFormat } from './types'

/**
 * Checks that a secp256k1 private key is usable.
 *
 * Length is not enough: only values from 1 to n-1 are allowed, where
 * n is the group order. A zero key and any value not smaller than n
 * do not define a point on the curve.
 *
 * The check is not decorative. A key outside the range, accepted by
 * the wallet, leads to one of two outcomes: either signing fails in
 * an unexpected place, or — worse — reduction modulo n yields an
 * address different from the one shown to the user, and the funds
 * go nowhere.
 *
 * @throws InvalidPrivateKeyError
 */
export function assertValidPrivateKey(privateKey: Uint8Array): void {
  if (privateKey.length !== PRIVATE_KEY_LENGTH) {
    throw new InvalidPrivateKeyError()
  }

  if (!secp256k1.utils.isValidSecretKey(privateKey)) {
    throw new InvalidPrivateKeyError()
  }
}

/** Check without throwing. For validation as the user types. */
export function isValidPrivateKey(privateKey: Uint8Array): boolean {
  try {
    assertValidPrivateKey(privateKey)
    return true
  } catch {
    return false
  }
}

/**
 * Computes the public key from a private key.
 *
 * Takes `ISecretBuffer`, not a raw array, on purpose: that forces
 * the caller to own the secret explicitly and wipe it. Accepting
 * `Uint8Array` would let a buffer whose lifetime nobody tracks be
 * passed in.
 *
 * @throws InvalidPrivateKeyError, SecretBufferWipedError
 */
export function privateKeyToPublicKey(
  privateKey: ISecretBuffer,
  format: PublicKeyFormat = PUBLIC_KEY_FORMAT.Compressed,
): Uint8Array {
  const bytes = privateKey.bytes

  assertValidPrivateKey(bytes)

  return secp256k1.getPublicKey(bytes, format === PUBLIC_KEY_FORMAT.Compressed)
}

/**
 * Derives an EVM address directly from a private key.
 *
 * Needed when importing a standalone key: there is no HD tree then,
 * and the path "private key -> public key -> keccak256 -> address"
 * is walked in full.
 *
 * The public key is requested uncompressed at once: that is the
 * form used in the address computation, and expanding a compressed
 * key in between would be extra work.
 *
 * @throws InvalidPrivateKeyError, SecretBufferWipedError
 */
export function privateKeyToAddress(privateKey: ISecretBuffer): Address {
  return publicKeyToAddress(privateKeyToPublicKey(privateKey, PUBLIC_KEY_FORMAT.Uncompressed))
}
