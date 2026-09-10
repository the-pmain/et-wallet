import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
  AddressChecksumMismatchError,
  InvalidAddressError,
  InvalidPublicKeyError,
} from '@/core/errors'
import type { Address } from '@/core/types'

import {
  ADDRESS_BYTE_LENGTH,
  COMPRESSED_PUBLIC_KEY_LENGTH,
  RAW_PUBLIC_KEY_LENGTH,
  UNCOMPRESSED_PUBLIC_KEY_LENGTH,
} from './types'

/** EVM address: 20 bytes, i.e. 40 hex characters after `0x`. */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** Hash nibble threshold at which an address character becomes uppercase. */
const CHECKSUM_UPPERCASE_THRESHOLD = 8

/**
 * Computes an address checksum per EIP-55.
 *
 * Algorithm: keccak256 of the lower-case address without the prefix;
 * then the i-th address character is uppercased if the i-th hash
 * nibble is at least 8.
 *
 * Why this is needed: an EVM address has no checksum of its own, so
 * a one-character typo yields another syntactically valid address.
 * Funds sent there are lost for good — nobody has a private key to
 * it. EIP-55 encodes the checksum in letter case and catches the
 * vast majority of typos.
 *
 * @param value Address with a `0x` prefix, in any case.
 */
export function toChecksumAddress(value: string): Address {
  const lowercase = value.toLowerCase().slice(2)
  const hash = bytesToHex(keccak_256(utf8ToBytes(lowercase)))

  let result = '0x'

  for (let index = 0; index < lowercase.length; index += 1) {
    const character = lowercase[index] as string
    const hashNibble = Number.parseInt(hash[index] as string, 16)

    result += hashNibble >= CHECKSUM_UPPERCASE_THRESHOLD ? character.toUpperCase() : character
  }

  return result as Address
}

/**
 * Creates an address after checking format and checksum.
 *
 * The only allowed way to obtain an `Address`.
 *
 * BEHAVIOUR UNDER DIFFERENT CASE — the key point of the whole
 * module:
 *
 * - An address entirely in lower or entirely in upper case carries
 *   no checksum. There is nothing to check; the address is simply
 *   brought to canonical form.
 *
 * - An address with mixed case carries a checksum, and it IS
 *   CHECKED. A mismatch is an error.
 *
 * Silently "fixing" the case of a mixed-case address is forbidden:
 * that is exactly when EIP-55 must fire. A wallet that "repairs"
 * such an address will send funds to a mistyped address, from
 * which they cannot be recovered.
 *
 * @throws InvalidAddressError if the format does not match.
 * @throws AddressChecksumMismatchError if the checksum does not match.
 */
export function toAddress(value: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new InvalidAddressError(value)
  }

  const body = value.slice(2)
  const isSingleCase = body === body.toLowerCase() || body === body.toUpperCase()

  if (isSingleCase) {
    return toChecksumAddress(value)
  }

  const checksummed = toChecksumAddress(value)

  if (checksummed !== value) {
    throw new AddressChecksumMismatchError(value)
  }

  return checksummed
}

/** Check without throwing. For validation as the user types. */
export function isValidAddress(value: string): boolean {
  try {
    toAddress(value)
    return true
  } catch {
    return false
  }
}

/**
 * Compares addresses ignoring case.
 *
 * Direct string comparison is unreliable: the same address appears
 * in lower case (RPC responses), in upper case (some explorers),
 * and in EIP-55 checksum. A comparison without normalisation means
 * the user's own account is not recognised in a list.
 */
export function areAddressesEqual(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Converts an address to 20 bytes.
 *
 * Needed when building contract-call data and when signing a
 * transaction: the address goes there in binary, not as a string.
 */
export function addressToBytes(address: Address): Uint8Array {
  const body = address.slice(2)
  const bytes = new Uint8Array(ADDRESS_BYTE_LENGTH)

  for (let index = 0; index < ADDRESS_BYTE_LENGTH; index += 1) {
    bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

/**
 * Creates an address from 20 bytes.
 *
 * The result is always in EIP-55 checksum form: an address obtained
 * from binary data must leave in canonical form.
 *
 * @throws InvalidAddressError on a wrong length.
 */
export function addressFromBytes(bytes: Uint8Array): Address {
  if (bytes.length !== ADDRESS_BYTE_LENGTH) {
    throw new InvalidAddressError(
      `expected ${String(ADDRESS_BYTE_LENGTH)} bytes, received ${String(bytes.length)}`,
    )
  }

  return toChecksumAddress(`0x${bytesToHex(bytes)}`)
}

/**
 * The zero address.
 *
 * Funds sent here are unrecoverable: nobody has a private key to
 * it. At the same time it is the legal `to` value when deploying a
 * contract, so forbidding it is not allowed — the UI must tell
 * those two cases apart.
 */
export const ZERO_ADDRESS: Address = toChecksumAddress('0x0000000000000000000000000000000000000000')

/**
 * The conventional burn address.
 *
 * Nothing special at the protocol level: an ordinary address whose
 * private key is known to nobody. Projects use it for a
 * demonstrative destruction of tokens.
 */
export const DEAD_ADDRESS: Address = toChecksumAddress('0x000000000000000000000000000000000000dead')

export function isZeroAddress(address: string): boolean {
  return areAddressesEqual(address, ZERO_ADDRESS)
}

/**
 * Whether the address is known to be unrecoverable.
 *
 * The check is heuristic and deliberately narrow: only addresses
 * conventionally used for burning are listed. Expanding the list
 * with guesses is forbidden — a false hit on a real recipient
 * would make the user cancel a legitimate transfer.
 *
 * Such an address does not forbid the send: burning can be
 * intentional. The user decides; the core's job is to say so.
 */
export function isBurnAddress(address: string): boolean {
  return isZeroAddress(address) || areAddressesEqual(address, DEAD_ADDRESS)
}

/**
 * Derives an EVM address from a public key.
 *
 * The address is the last 20 bytes of keccak256 of the UNCOMPRESSED
 * public key without the `0x04` prefix byte, i.e. of 64 bytes of
 * coordinates X and Y.
 *
 * Three key encodings are accepted:
 * - 33 bytes, compressed SEC1 (what BIP-32 returns);
 * - 65 bytes, uncompressed SEC1 with prefix `0x04`;
 * - 64 bytes, coordinates without a prefix.
 *
 * A compressed key is expanded by recovering the point on the
 * curve: Y is computed from X by the secp256k1 equation. The
 * operation is done by `@noble/curves`; there is no home-grown
 * curve arithmetic here and there must not be.
 *
 * @throws InvalidPublicKeyError on a bad length or if the point
 *         is not on the curve.
 */
export function publicKeyToAddress(publicKey: Uint8Array): Address {
  const raw = toRawPublicKey(publicKey)
  const hash = keccak_256(raw)

  return addressFromBytes(hash.slice(hash.length - ADDRESS_BYTE_LENGTH))
}

/** Brings a public key to 64 bytes of coordinates X and Y. */
function toRawPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === RAW_PUBLIC_KEY_LENGTH) {
    return publicKey
  }

  if (publicKey.length === UNCOMPRESSED_PUBLIC_KEY_LENGTH) {
    if (publicKey[0] !== 0x04) {
      throw new InvalidPublicKeyError('an uncompressed key must start with the byte 0x04')
    }

    return publicKey.slice(1)
  }

  if (publicKey.length === COMPRESSED_PUBLIC_KEY_LENGTH) {
    try {
      /* Point recovery checks that it lies on the curve. A key that
         fails is rejected, not turned into an address to which no
         private key exists. */
      return secp256k1.Point.fromBytes(publicKey).toBytes(false).slice(1)
    } catch (error) {
      throw new InvalidPublicKeyError('the point is not on the secp256k1 curve', { cause: error })
    }
  }

  throw new InvalidPublicKeyError(
    `allowed lengths are ${String(COMPRESSED_PUBLIC_KEY_LENGTH)}, ` +
      `${String(RAW_PUBLIC_KEY_LENGTH)} and ${String(UNCOMPRESSED_PUBLIC_KEY_LENGTH)} bytes, ` +
      `received ${String(publicKey.length)}`,
  )
}
