import { describe, expect, it } from 'vitest'

import {
  TRANSACTION_STATUS,
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  toAddress,
  toChainId,
  type ITransferRecord,
  type TransferDirection,
  type TransferKind,
  type TxHash,
} from '@/core'

import {
  DIRECTION_FILTER,
  EMPTY_TRANSFER_FILTER,
  TRANSFER_CATEGORY,
  filterTransfers,
  isFilterActive,
} from './transfer-filter'

const CHAIN_ID = toChainId(1n)
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const PEER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** History record with the given traits. Other fields do not affect the filter. */
function record(params: {
  id: string
  kind: TransferKind
  direction?: TransferDirection
  hash?: string
  from?: string
  to?: string | null
  contract?: string | null
  symbol?: string | null
  tokenId?: bigint | null
}): ITransferRecord {
  return {
    id: params.id,
    hash: (params.hash ?? `0x${params.id.repeat(8)}`) as TxHash,
    chainId: CHAIN_ID,
    kind: params.kind,
    direction: params.direction ?? TRANSFER_DIRECTION.Incoming,
    from: toAddress(params.from ?? PEER),
    to: params.to === null ? null : toAddress(params.to ?? OWNER),
    value: 1n,
    tokenId: params.tokenId ?? null,
    asset: {
      contract: params.contract === null ? null : toAddress(params.contract ?? USDC),
      symbol: params.symbol === undefined ? 'USDC' : params.symbol,
      decimals: 6,
    },
    blockNumber: 19_000n,
    timestamp: null,
    source: TRANSFER_SOURCE.Logs,
    status: TRANSACTION_STATUS.Confirmed,
  }
}

const NATIVE = record({ id: 'a', kind: TRANSFER_KIND.Native, contract: null, symbol: null })
const TOKEN = record({ id: 'b', kind: TRANSFER_KIND.Erc20 })
const NFT_721 = record({ id: 'c', kind: TRANSFER_KIND.Erc721, tokenId: 42n, symbol: 'BAYC' })
const NFT_1155 = record({ id: 'd', kind: TRANSFER_KIND.Erc1155, tokenId: 7n, symbol: null })

const ALL = [NATIVE, TOKEN, NFT_721, NFT_1155]

/** Ids of the filtered records — easier to read than comparing whole objects. */
function ids(transfers: readonly ITransferRecord[]): readonly string[] {
  return transfers.map((item) => item.id)
}

describe('isFilterActive', () => {
  it('default conditions filter nothing', () => {
    expect(isFilterActive(EMPTY_TRANSFER_FILTER)).toBe(false)
  })

  it('a query of only spaces is not a condition', () => {
    /* Otherwise the empty state would say "nothing matched" where
       there are in fact no conditions. */
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, query: '   ' })).toBe(false)
  })

  it('a selected category counts as a condition', () => {
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, category: TRANSFER_CATEGORY.Nft })).toBe(true)
  })

  it('a selected direction counts as a condition', () => {
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, direction: DIRECTION_FILTER.Outgoing })).toBe(
      true,
    )
  })
})

describe('filterTransfers: category', () => {
  it('returns everything when there are no conditions', () => {
    expect(ids(filterTransfers(ALL, EMPTY_TRANSFER_FILTER))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('selects native-currency transfers', () => {
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Native,
    })

    expect(ids(result)).toEqual(['a'])
  })

  it('selects ERC-20 transfers', () => {
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Erc20,
    })

    expect(ids(result)).toEqual(['b'])
  })

  it('the NFT category includes both ERC-721 and ERC-1155', () => {
    /* To the owner they are one kind of property; splitting by
       standard would force them to know which contract minted the
       item. */
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Nft,
    })

    expect(ids(result)).toEqual(['c', 'd'])
  })
})

describe('filterTransfers: direction', () => {
  const outgoing = record({
    id: 'e',
    kind: TRANSFER_KIND.Erc20,
    direction: TRANSFER_DIRECTION.Outgoing,
  })
  const self = record({ id: 'f', kind: TRANSFER_KIND.Native, direction: TRANSFER_DIRECTION.Self })
  const mixed = [TOKEN, outgoing, self]

  it('selects incoming', () => {
    const result = filterTransfers(mixed, {
      ...EMPTY_TRANSFER_FILTER,
      direction: DIRECTION_FILTER.Incoming,
    })

    expect(ids(result)).toEqual(['b', 'f'])
  })

  it('selects outgoing', () => {
    const result = filterTransfers(mixed, {
      ...EMPTY_TRANSFER_FILTER,
      direction: DIRECTION_FILTER.Outgoing,
    })

    expect(ids(result)).toEqual(['e', 'f'])
  })

  it('a self-transfer matches both directions', () => {
    /* It is both income and expense. Dropping it from both sets would
       hide an existing operation. */
    for (const direction of [DIRECTION_FILTER.Incoming, DIRECTION_FILTER.Outgoing]) {
      const result = filterTransfers([self], { ...EMPTY_TRANSFER_FILTER, direction })

      expect(ids(result)).toEqual(['f'])
    }
  })
})

describe('filterTransfers: search', () => {
  it('finds by the full counterparty address', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: PEER })

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores case', () => {
    /* The same address arrives lowercase from the node and in
       EIP-55 checksum form. */
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      query: PEER.toUpperCase(),
    })

    expect(result).toHaveLength(4)
  })

  it('finds by the last characters of the address', () => {
    /* Those are the ones visible in the truncated list form; a
       prefix search would miss this query. */
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: PEER.slice(-6) })

    expect(result).toHaveLength(4)
  })

  it('finds by contract address', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: USDC })

    expect(ids(result)).toEqual(['b', 'c', 'd'])
  })

  it('finds by token symbol', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: 'usdc' })

    expect(ids(result)).toEqual(['b'])
  })

  it('finds by item id', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: '#42' })

    expect(ids(result)).toEqual(['c'])
  })

  it('finds by transaction hash', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: NFT_721.hash })

    expect(ids(result)).toEqual(['c'])
  })

  it('does not stumble on a record without a symbol or contract', () => {
    /* A native-currency transfer has neither. */
    const result = filterTransfers([NATIVE], { ...EMPTY_TRANSFER_FILTER, query: 'usdc' })

    expect(result).toEqual([])
  })

  it('leading and trailing spaces in the query do not affect the result', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: '  usdc  ' })

    expect(ids(result)).toEqual(['b'])
  })

  it('conditions apply together, not separately', () => {
    const result = filterTransfers(ALL, {
      category: TRANSFER_CATEGORY.Nft,
      direction: DIRECTION_FILTER.Incoming,
      query: 'bayc',
    })

    expect(ids(result)).toEqual(['c'])
  })
})
