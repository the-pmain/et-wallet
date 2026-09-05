import type { Address, ChainId } from '@/core/types'

/** A resolved name together with the address it points at. */
export interface IEnsResolution {
  /**
   * Canonical name — exactly what was hashed.
   *
   * Fit for comparison and re-resolution. For showing to the user
   * use {@link IEnsResolution.displayName}.
   */
  readonly name: string

  /**
   * Name in a form fit for display.
   *
   * Differs from the canonical form in emoji handling: normalization
   * strips variation selectors so the node is unique, but on screen
   * emoji should look familiar. This value must not be hashed.
   */
  readonly displayName: string

  /**
   * The name is written in ASCII only.
   *
   * ENSIP-15 forbids mixing scripts inside a label, but a name
   * written entirely in another script that looks Latin remains
   * legitimate and belongs to someone else. The UI must say so,
   * not stay silent.
   */
  readonly isAscii: boolean

  /** Address from the `addr` record. A zero address never lands here. */
  readonly address: Address
}

/**
 * ENS name resolution.
 *
 * ONE PROPERTY MATTERS MORE THAN THE REST: a reverse record proves
 * nothing by itself. Any address owner may declare `binance.eth`
 * as their name, and the node will honestly return that string.
 * Therefore {@link IEnsService.lookupAddress} must confirm the
 * received name with a forward resolve and return `null` on a
 * mismatch. An implementation that shows a reverse record without
 * that check turns ENS into a ready tool for recipient substitution.
 *
 * BOUNDS. Only the Ethereum network is supported: the registry
 * exists in one instance and on one chain. Off-chain resolvers
 * (EIP-3668, CCIP-Read) are not supported — following them would
 * mean requesting an arbitrary internet address named by a
 * contract. Names with such resolvers are honestly treated as
 * unresolvable.
 */
export interface IEnsService {
  isSupported(chainId: ChainId): boolean

  /**
   * Resolves a name to an address.
   *
   * A NODE FAILURE IS NOT SUBSTITUTED WITH "NO RECORD". The first
   * means "unknown" and throws; the second means "no recipient"
   * and returns `null`. Collapse them to one value and a user
   * whose node merely failed to answer will see "name not found"
   * and type an address by hand, believing the name does not exist.
   *
   * @param name Name in any case. Normalized before hashing.
   * @returns `null` if the name is outside the supported character
   *          set, the network is not Ethereum, or the record does
   *          not exist. "No record" and "zero address" are not
   *          distinguished on purpose: both mean there is no recipient.
   * @throws Transport errors — the node is unreachable or rejected the call.
   */
  resolveName(name: string): Promise<IEnsResolution | null>

  /**
   * Looks up the name declared by the address owner.
   *
   * The result is CONFIRMED by a forward resolve: only a name that
   * itself points at this same address is returned.
   *
   * @returns `null` if there is no record, the name fails ENSIP-15
   *          normalization, or the check did not match.
   * @throws Transport errors — for the same reason as above.
   */
  lookupAddress(address: Address): Promise<IEnsResolution | null>

  /**
   * Clears the cache.
   *
   * Called when the session closes: names are bound to wallet
   * addresses and must not outlive the lock.
   */
  clearCache(): void
}
