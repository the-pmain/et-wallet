import type { ILogger } from '@/core/platform'
import type { IProvider } from '@/core/provider'
import type { Address } from '@/core/types'

/**
 * Search for addresses that have already been used.
 *
 * WHY THIS IS NEEDED. A wallet restored from a seed phrase creates
 * one account — the first by count. For a person who had five, four
 * simply do not appear: the addresses are derived from the phrase,
 * but the wallet does not know about them until it derives them.
 * The owner sees an empty wallet instead of their funds and
 * reasonably concludes that the funds are gone. That is the worst
 * possible first screen after restore.
 *
 * HOW "USED" IS DEFINED. By two signs, and both are needed:
 *
 * - sent-transaction count greater than zero — something was sent
 *   from the address;
 * - balance greater than zero — something sits on the address.
 *
 * Neither alone is enough: an address that only received has a
 * zero count, and an address that was emptied has a zero balance.
 *
 * WHAT THIS SEARCH DOES NOT FIND. An address with no sends and no
 * native currency, but with tokens or items. Seeing those would
 * mean querying every contract for every address — tens of requests
 * per address instead of two. The limit is named in the UI: staying
 * silent about it would again promise completeness that is not
 * there.
 *
 * A GAP OF TWENTY ADDRESSES is the BIP-44 rule, not a guess.
 * Wallets skip addresses at creation, so the search does not stop
 * at the first empty one: it continues until twenty unused
 * addresses appear in a row.
 *
 * PRIVACY COST. The search tells the node operator two dozen
 * addresses at once and ties them together. That is exactly what
 * the wallet usually tries not to do, so the search does not run
 * by itself on every launch: it runs once after restore or on the
 * owner's direct request.
 */

/** Empty-address gap after which the search stops. */
export const DEFAULT_GAP_LIMIT = 20

/**
 * Cap on the number of addresses checked.
 *
 * Protection against an infinite walk if the node wrongly reports
 * activity on every address. Two hundred is far more than a person
 * typically has, and still finite.
 */
export const MAX_SCANNED_ADDRESSES = 200

export interface IDiscoveryOptions {
  readonly gapLimit?: number
  readonly maxScanned?: number
}

export interface IDiscoveryResult {
  /** Indexes of addresses that were used. Always ascending. */
  readonly usedIndexes: readonly number[]

  /** How many addresses were checked. Needed to name the depth honestly. */
  readonly scanned: number

  /**
   * Search stopped because of the cap, not the gap.
   *
   * Means used addresses may remain further on, and saying "these
   * are all your accounts" is not allowed.
   */
  readonly stoppedByLimit: boolean
}

export type AddressAt = (addressIndex: number) => Address

/**
 * Finds addresses that have been used.
 *
 * A NODE REFUSAL STOPS THE SEARCH, IT DOES NOT SKIP THE ADDRESS.
 * Skipping would mean a used address silently missed the result —
 * exactly what this search is written against. What was found
 * before the refusal is returned: it has been checked.
 */
export async function discoverUsedAccounts(
  provider: IProvider,
  addressAt: AddressAt,
  logger: ILogger,
  options: IDiscoveryOptions = {},
): Promise<IDiscoveryResult> {
  const gapLimit = options.gapLimit ?? DEFAULT_GAP_LIMIT
  const maxScanned = options.maxScanned ?? MAX_SCANNED_ADDRESSES

  const usedIndexes: number[] = []

  let emptyInRow = 0
  let scanned = 0

  while (emptyInRow < gapLimit && scanned < maxScanned) {
    const addressIndex = scanned
    const address = addressAt(addressIndex)

    let isUsed: boolean

    try {
      isUsed = await hasActivity(provider, address)
    } catch (error) {
      logger.warn('Address discovery stopped: the node did not answer', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return { usedIndexes, scanned, stoppedByLimit: false }
    }

    scanned += 1

    if (isUsed) {
      usedIndexes.push(addressIndex)
      emptyInRow = 0
    } else {
      emptyInRow += 1
    }
  }

  return { usedIndexes, scanned, stoppedByLimit: scanned >= maxScanned }
}

/**
 * Whether the address has been used.
 *
 * Both requests go out together: they are independent, and running
 * them in sequence would double search time on a slow node.
 */
async function hasActivity(provider: IProvider, address: Address): Promise<boolean> {
  const [nonce, balance] = await Promise.all([
    provider.getTransactionCount(address),
    provider.getBalance(address),
  ])

  return nonce > 0 || balance > 0n
}
