import type { Brand } from '@/shared/types'

/**
 * Domain primitives.
 *
 * All of them are branded wrappers over base types. TypeScript's type
 * system is structural: without branding, `Address`, `TxHash`, and a
 * private key are indistinguishable, because all are `string`. The
 * compiler would silently allow passing one in place of another.
 *
 * Values of these types are created ONLY through validating
 * constructors. A type assertion (`as Address`) in application code
 * is forbidden: it bypasses validation and makes the whole mechanism
 * pointless.
 */

/** Arbitrary hex string with a `0x` prefix. */
export type HexString = Brand<string, 'HexString'>

/**
 * EVM account address in EIP-55 checksum form.
 *
 * Stored and compared only in checksum form. Letter case in EIP-55
 * carries the checksum: comparing addresses without normalisation
 * treats the same account as two different ones.
 */
export type Address = Brand<string, 'Address'>

/** Transaction hash: 32 bytes in hex. */
export type TxHash = Brand<string, 'TxHash'>

/** Block hash: 32 bytes in hex. */
export type BlockHash = Brand<string, 'BlockHash'>

/**
 * Network identifier per EIP-155.
 *
 * `bigint`, not `number`, on purpose. EIP-155 sets no upper bound
 * for chainId. Every existing network fits in `number`, but relying
 * on that is forbidden: silent truncation means the wallet signs a
 * transaction for a network other than the one shown to the user.
 * That signature can be replayed on another network.
 */
export type ChainId = Brand<bigint, 'ChainId'>

/**
 * Amount in the network native currency's smallest units (wei on Ethereum).
 *
 * Only `bigint`. `number` is exact up to 2^53-1, while wei values
 * reach 2^256-1. Using `number` silently loses precision — i.e.
 * sends an amount different from the one requested.
 */
export type Wei = Brand<bigint, 'Wei'>

/**
 * Amount in a token's smallest units.
 *
 * Separated from {@link Wei} on purpose: 1000 units of USDC (6
 * decimals) and 1000 wei are completely different quantities, and
 * the compiler must tell them apart. Interpretation requires the
 * token's `decimals`.
 */
export type TokenUnits = Brand<bigint, 'TokenUnits'>

/** BIP-32 derivation path, e.g. `m/44'/60'/0'/0/0`. */
export type DerivationPath = Brand<string, 'DerivationPath'>

/** Instant in time, Unix timestamp in milliseconds. */
export type Timestamp = Brand<number, 'Timestamp'>

/** Internal account id. Not an address: an account may be re-imported. */
export type AccountId = Brand<string, 'AccountId'>

/** Internal keyring id. */
export type KeyringId = Brand<string, 'KeyringId'>

/**
 * Block reference in node requests.
 *
 * String tags come from the JSON-RPC spec. `bigint` is a concrete
 * block number.
 */
export type BlockTag = 'latest' | 'pending' | 'earliest' | 'safe' | 'finalized' | bigint

/** Unsubscribe function returned by subscription methods. */
export type Unsubscribe = () => void
