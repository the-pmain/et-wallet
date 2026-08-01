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

/** Запись истории с заданными признаками. Остальные поля не влияют на отбор. */
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

/** Идентификаторы отобранных записей — читаемее сравнения объектов целиком. */
function ids(transfers: readonly ITransferRecord[]): readonly string[] {
  return transfers.map((item) => item.id)
}

describe('isFilterActive', () => {
  it('исходные условия ничего не отсеивают', () => {
    expect(isFilterActive(EMPTY_TRANSFER_FILTER)).toBe(false)
  })

  it('запрос из одних пробелов не считается условием', () => {
    /* Иначе пустое состояние сообщило бы «под условия ничего не подошло»
       там, где условий на деле нет. */
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, query: '   ' })).toBe(false)
  })

  it('выбранная категория считается условием', () => {
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, category: TRANSFER_CATEGORY.Nft })).toBe(true)
  })

  it('выбранное направление считается условием', () => {
    expect(isFilterActive({ ...EMPTY_TRANSFER_FILTER, direction: DIRECTION_FILTER.Outgoing })).toBe(
      true,
    )
  })
})

describe('filterTransfers: категория', () => {
  it('без условий возвращает всё', () => {
    expect(ids(filterTransfers(ALL, EMPTY_TRANSFER_FILTER))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('отбирает переводы нативной валюты', () => {
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Native,
    })

    expect(ids(result)).toEqual(['a'])
  })

  it('отбирает переводы ERC-20', () => {
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Erc20,
    })

    expect(ids(result)).toEqual(['b'])
  })

  it('под категорию NFT попадают и ERC-721, и ERC-1155', () => {
    /* Для владельца это один вид имущества; разделение по стандартам
       заставило бы его знать, каким контрактом выпущен предмет. */
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      category: TRANSFER_CATEGORY.Nft,
    })

    expect(ids(result)).toEqual(['c', 'd'])
  })
})

describe('filterTransfers: направление', () => {
  const outgoing = record({
    id: 'e',
    kind: TRANSFER_KIND.Erc20,
    direction: TRANSFER_DIRECTION.Outgoing,
  })
  const self = record({ id: 'f', kind: TRANSFER_KIND.Native, direction: TRANSFER_DIRECTION.Self })
  const mixed = [TOKEN, outgoing, self]

  it('отбирает входящие', () => {
    const result = filterTransfers(mixed, {
      ...EMPTY_TRANSFER_FILTER,
      direction: DIRECTION_FILTER.Incoming,
    })

    expect(ids(result)).toEqual(['b', 'f'])
  })

  it('отбирает исходящие', () => {
    const result = filterTransfers(mixed, {
      ...EMPTY_TRANSFER_FILTER,
      direction: DIRECTION_FILTER.Outgoing,
    })

    expect(ids(result)).toEqual(['e', 'f'])
  })

  it('перевод самому себе попадает в оба направления', () => {
    /* Он одновременно и приход, и расход. Исключение из обоих наборов
       скрыло бы существующую операцию. */
    for (const direction of [DIRECTION_FILTER.Incoming, DIRECTION_FILTER.Outgoing]) {
      const result = filterTransfers([self], { ...EMPTY_TRANSFER_FILTER, direction })

      expect(ids(result)).toEqual(['f'])
    }
  })
})

describe('filterTransfers: поиск', () => {
  it('находит по адресу контрагента целиком', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: PEER })

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('не учитывает регистр', () => {
    /* Один и тот же адрес приходит и в нижнем регистре от узла,
       и в записи с контрольной суммой EIP-55. */
    const result = filterTransfers(ALL, {
      ...EMPTY_TRANSFER_FILTER,
      query: PEER.toUpperCase(),
    })

    expect(result).toHaveLength(4)
  })

  it('находит по последним символам адреса', () => {
    /* Именно они видны в усечённой записи адреса в списке; поиск
       по началу строки такой запрос не нашёл бы. */
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: PEER.slice(-6) })

    expect(result).toHaveLength(4)
  })

  it('находит по адресу контракта', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: USDC })

    expect(ids(result)).toEqual(['b', 'c', 'd'])
  })

  it('находит по символу токена', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: 'usdc' })

    expect(ids(result)).toEqual(['b'])
  })

  it('находит по идентификатору предмета', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: '#42' })

    expect(ids(result)).toEqual(['c'])
  })

  it('находит по хэшу транзакции', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: NFT_721.hash })

    expect(ids(result)).toEqual(['c'])
  })

  it('не спотыкается о запись без символа и контракта', () => {
    /* Перевод нативной валюты не имеет ни того, ни другого. */
    const result = filterTransfers([NATIVE], { ...EMPTY_TRANSFER_FILTER, query: 'usdc' })

    expect(result).toEqual([])
  })

  it('пробелы по краям запроса не влияют на результат', () => {
    const result = filterTransfers(ALL, { ...EMPTY_TRANSFER_FILTER, query: '  usdc  ' })

    expect(ids(result)).toEqual(['b'])
  })

  it('условия применяются вместе, а не по отдельности', () => {
    const result = filterTransfers(ALL, {
      category: TRANSFER_CATEGORY.Nft,
      direction: DIRECTION_FILTER.Incoming,
      query: 'bayc',
    })

    expect(ids(result)).toEqual(['c'])
  })
})
