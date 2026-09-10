import { toChainId, type ChainId } from '@/core/types'

/**
 * Соответствие сетей идентификаторам CoinGecko.
 *
 * ЗНАЧЕНИЯ ПОЛУЧЕНЫ ИЗ `GET /api/v3/asset_platforms`, А НЕ ВПИСАНЫ
 * ПО ПАМЯТИ. Идентификатор платформы непроверяем при чтении кода:
 * `optimism` вместо `optimistic-ethereum` даёт не ошибку, а пустой
 * ответ — то есть портфель без стоимости и ни одного сообщения
 * о причине. Сверка выполнена 31 июля 2026 года.
 *
 * Идентификатор нативной монеты взят оттуда же, из поля `native_coin_id`
 * той же записи: у Arbitrum, OP Mainnet и Base это `ethereum`, потому
 * что нативная валюта у них — тот же эфир.
 */
export interface ICoinGeckoPlatform {
  /** Идентификатор платформы для запроса цен по адресу контракта. */
  readonly platformId: string

  /** Идентификатор нативной монеты для запроса цены по имени. */
  readonly nativeCoinId: string
}

/** Ключ — идентификатор сети десятичной строкой. */
const PLATFORMS: ReadonlyMap<string, ICoinGeckoPlatform> = new Map([
  ['1', { platformId: 'ethereum', nativeCoinId: 'ethereum' }],
  ['56', { platformId: 'binance-smart-chain', nativeCoinId: 'binancecoin' }],
  ['137', { platformId: 'polygon-pos', nativeCoinId: 'polygon-ecosystem-token' }],
  ['42161', { platformId: 'arbitrum-one', nativeCoinId: 'ethereum' }],
  ['10', { platformId: 'optimistic-ethereum', nativeCoinId: 'ethereum' }],
  ['8453', { platformId: 'base', nativeCoinId: 'ethereum' }],
  ['43114', { platformId: 'avalanche', nativeCoinId: 'avalanche-2' }],
])

/**
 * Возвращает соответствие для сети.
 *
 * `null` для сети, которой нет в перечне: пользовательская сеть может
 * не поддерживаться источником вовсе, и подставить сюда похожую значило
 * бы показать курс чужого актива.
 */
export function findCoinGeckoPlatform(chainId: ChainId): ICoinGeckoPlatform | null {
  return PLATFORMS.get(chainId.toString()) ?? null
}

/** Сети, для которых есть соответствие в справочнике CoinGecko. */
export function listCoinGeckoPlatforms(): ReadonlyArray<{
  readonly chainId: ChainId
  readonly platform: ICoinGeckoPlatform
}> {
  return [...PLATFORMS.entries()].map(([id, platform]) => ({
    chainId: toChainId(id),
    platform,
  }))
}
