import { TRANSFER_DIRECTION, TRANSFER_KIND, type ITransferRecord } from '@/core'

/**
 * Category for filtering records.
 *
 * ERC-721 and ERC-1155 are one "NFT" category on purpose: to the
 * owner they are one kind of property, and the standard difference
 * is a contract-implementation detail. The standard itself stays on
 * the record and is shown in the list row.
 */
export const TRANSFER_CATEGORY = {
  All: 'all',
  /** Native currency of the chain. */
  Native: 'native',
  /** Fungible ERC-20 tokens. */
  Erc20: 'erc20',
  /** Collectibles: ERC-721 and ERC-1155. */
  Nft: 'nft',
} as const

export type TransferCategory = (typeof TRANSFER_CATEGORY)[keyof typeof TRANSFER_CATEGORY]

/** Direction for filtering records. */
export const DIRECTION_FILTER = {
  All: 'all',
  Incoming: 'incoming',
  Outgoing: 'outgoing',
} as const

export type DirectionFilter = (typeof DIRECTION_FILTER)[keyof typeof DIRECTION_FILTER]

/** Filter conditions set by the user. */
export interface ITransferFilter {
  readonly category: TransferCategory
  readonly direction: DirectionFilter

  /** Search string exactly as the user typed it. */
  readonly query: string
}

/** Conditions that filter nothing. The screen's initial state. */
export const EMPTY_TRANSFER_FILTER: ITransferFilter = {
  category: TRANSFER_CATEGORY.All,
  direction: DIRECTION_FILTER.All,
  query: '',
}

/**
 * Whether the current conditions filter anything.
 *
 * The UI needs this to tell empty history from an empty filter
 * result. Those are different claims: "there were no operations" and
 * "nothing matched". The first in place of the second reads as funds
 * gone.
 */
export function isFilterActive(filter: ITransferFilter): boolean {
  return (
    filter.category !== TRANSFER_CATEGORY.All ||
    filter.direction !== DIRECTION_FILTER.All ||
    filter.query.trim() !== ''
  )
}

/**
 * Filter history records by the given conditions.
 *
 * Works only on records already fetched and knows nothing about the
 * source's limits. An empty result does not mean those operations are
 * absent on-chain — the UI must say so, using `IHistoryLimits`.
 */
export function filterTransfers(
  transfers: readonly ITransferRecord[],
  filter: ITransferFilter,
): readonly ITransferRecord[] {
  const query = filter.query.trim().toLowerCase()

  return transfers.filter(
    (record) =>
      matchesCategory(record, filter.category) &&
      matchesDirection(record, filter.direction) &&
      matchesQuery(record, query),
  )
}

/** Whether the record matches the selected category. */
function matchesCategory(record: ITransferRecord, category: TransferCategory): boolean {
  switch (category) {
    case TRANSFER_CATEGORY.All:
      return true
    case TRANSFER_CATEGORY.Native:
      return record.kind === TRANSFER_KIND.Native
    case TRANSFER_CATEGORY.Erc20:
      return record.kind === TRANSFER_KIND.Erc20
    case TRANSFER_CATEGORY.Nft:
      return record.kind === TRANSFER_KIND.Erc721 || record.kind === TRANSFER_KIND.Erc1155
  }
}

/**
 * Whether the record matches the selected direction.
 *
 * A self-transfer matches both incoming and outgoing: it is both.
 * Dropping it from both sets would hide an existing operation — and
 * a hidden operation in wallet history is worse than an extra one.
 */
function matchesDirection(record: ITransferRecord, direction: DirectionFilter): boolean {
  if (direction === DIRECTION_FILTER.All || record.direction === TRANSFER_DIRECTION.Self) {
    return true
  }

  return record.direction === direction
}

/**
 * Whether the record matches the search string.
 *
 * Search is a substring, not a prefix. A prefix match would miss an
 * address the user remembers by its last characters — the ones shown
 * in the truncated list form. An empty search result reads as "those
 * operations never happened", and that error costs more than an extra
 * row: an extra row is seen and discarded, a missing one is not.
 *
 * Case is ignored: the same address arrives lowercase from the node
 * and in EIP-55 checksum form.
 *
 * @param query Search string, already lowercased and trimmed.
 */
function matchesQuery(record: ITransferRecord, query: string): boolean {
  if (query === '') {
    return true
  }

  const haystack = [
    record.hash,
    record.from,
    record.to,
    record.asset.contract,
    record.asset.symbol,
    record.tokenId === null ? null : `#${record.tokenId.toString()}`,
  ]

  return haystack.some((field) => field !== null && field.toLowerCase().includes(query))
}
