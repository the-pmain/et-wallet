import type { Address, ChainId } from '@/core/types'

/**
 * Известные контракты → идентификатор монеты в `/coins/markets`.
 *
 * Каталог рынка не содержит адресов. Без этой таблицы ERC-20 из витрины
 * остались бы без курса после единственного запроса за топ монет.
 * Нативная валюта сюда не входит: она ищется по `native_coin_id`.
 */
const KNOWN_MARKET_TOKEN_IDS: ReadonlyMap<string, string> = new Map([
  ['1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'usd-coin'],
  ['1:0xdac17f958d2ee523a2206206994597c13d831ec7', 'tether'],
  ['1:0x6b175474e89094c44da98b954eedeac495271d0f', 'dai'],
  ['1:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 'wrapped-bitcoin'],
  ['1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'weth'],
  ['10:0x0b2c639c533813f4aa9d7837caf62653d097ff85', 'usd-coin'],
  ['10:0x4200000000000000000000000000000000000006', 'weth'],
  ['8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'usd-coin'],
  ['8453:0x4200000000000000000000000000000000000006', 'weth'],
  ['42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'usd-coin'],
  ['42161:0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'weth'],
  ['137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 'usd-coin'],
  ['56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 'usd-coin'],
])

export function knownMarketCoinId(chainId: ChainId, address: Address): string | null {
  return KNOWN_MARKET_TOKEN_IDS.get(`${chainId.toString()}:${address.toLowerCase()}`) ?? null
}
