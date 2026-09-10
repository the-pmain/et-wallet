import { toChainId, type ChainId } from '@/core/types'

/**
 * Mapping of networks to CoinGecko identifiers.
 *
 * VALUES COME FROM `GET /api/v3/asset_platforms`, NOT FROM MEMORY.
 * A platform id is unverifiable when reading the code: `optimism`
 * instead of `optimistic-ethereum` yields not an error but an empty
 * response — i.e. a portfolio with no value and no message about
 * why. Checked on 31 July 2026.
 *
 * The native-coin id is taken from the same place, from
 * `native_coin_id` of the same record: on Arbitrum, OP Mainnet, and
 * Base it is `ethereum`, because their native currency is the same
 * ether.
 */
export interface ICoinGeckoPlatform {
  /** Platform id for a price request by contract address. */
  readonly platformId: string

  /** Native-coin id for a price request by name. */
  readonly nativeCoinId: string
}

/** Key is the network id as a decimal string. */
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
 * Returns the mapping for a network.
 *
 * `null` for a network not in the list: a custom network may not be
 * supported by the source at all, and substituting a similar one
 * would show the rate of a foreign asset.
 */
export function findCoinGeckoPlatform(chainId: ChainId): ICoinGeckoPlatform | null {
  return PLATFORMS.get(chainId.toString()) ?? null
}

/** Networks that have a mapping in the CoinGecko directory. */
export function listCoinGeckoPlatforms(): ReadonlyArray<{
  readonly chainId: ChainId
  readonly platform: ICoinGeckoPlatform
}> {
  return [...PLATFORMS.entries()].map(([id, platform]) => ({
    chainId: toChainId(id),
    platform,
  }))
}
