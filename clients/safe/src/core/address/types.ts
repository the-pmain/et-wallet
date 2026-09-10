/**
 * Encoding of a secp256k1 public key.
 *
 * Compressed (33 bytes) holds the X coordinate and the Y-parity bit;
 * used in BIP-32 and saves space. Uncompressed (65 bytes) holds both
 * coordinates and is required when deriving an Ethereum address.
 *
 * The type is declared here, not in the HD-wallet module, on
 * purpose: an address is derived both from an HD key and from an
 * imported private key. Placing it in `core/address` sets the
 * dependency direction `hdwallet -> address` and rules out a cycle.
 */
export const PUBLIC_KEY_FORMAT = {
  Compressed: 'compressed',
  Uncompressed: 'uncompressed',
} as const

export type PublicKeyFormat = (typeof PUBLIC_KEY_FORMAT)[keyof typeof PUBLIC_KEY_FORMAT]

/** EVM address length in bytes. */
export const ADDRESS_BYTE_LENGTH = 20

/** secp256k1 private-key length in bytes. */
export const PRIVATE_KEY_LENGTH = 32

/** Compressed SEC1 public key: prefix 0x02/0x03 and the X coordinate. */
export const COMPRESSED_PUBLIC_KEY_LENGTH = 33

/** Uncompressed SEC1 public key: prefix 0x04 and coordinates X, Y. */
export const UNCOMPRESSED_PUBLIC_KEY_LENGTH = 65

/** Coordinates X and Y without the prefix byte — the form Ethereum uses. */
export const RAW_PUBLIC_KEY_LENGTH = 64
