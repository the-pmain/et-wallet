import type { Address, DerivationPath } from '@/core/types'

/* `PUBLIC_KEY_FORMAT` was moved to `core/address`: an address is
   derived both from an HD key and from an imported private key, so
   the type must live in a module they share. The dependency
   direction is `hdwallet -> address`; there is no reverse link. */

/**
 * An account derived from the HD tree.
 *
 * A PUBLIC structure: there is no private key in it and there must
 * not be. It freely enters UI state and is serialised. The private
 * key is issued by a separate method that returns an
 * `ISecretBuffer`, which the caller must wipe.
 */
export interface IHdAccount {
  /** Address index — the last level of the path. */
  readonly addressIndex: number

  readonly path: DerivationPath

  /** EVM address in EIP-55 checksum form. */
  readonly address: Address

  /** Public key in compressed SEC1 form, 33 bytes. */
  readonly publicKey: Uint8Array
}

/**
 * Upper bound on accounts derived in one call.
 *
 * The cap protects against an accidental request for a million
 * accounts: each derivation is HMAC-SHA512 plus an elliptic-curve
 * operation, and such a loop would block the thread for minutes.
 * A deliberate bypass is possible by repeated calls with a start
 * index.
 */
export const MAX_ACCOUNTS_PER_CALL = 100
