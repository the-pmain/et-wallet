import type { IRemoteAssetToken, IRemoteAssets } from '../model/RemoteUserDirectory'

/**
 * Витрина, которую клиент кладёт в `POST /v1/users`.
 *
 * Остаток у каждой позиции — `"0"`. Курса и оценки в объекте нет:
 * их считает экран по снимку рынка.
 */
export const STARTING_REMOTE_TOKENS: readonly IRemoteAssetToken[] = [
  holding('1', 'native', null, 'ETH', 'Ether', 18),
  holding('1', 'ERC-20', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6),
  holding('1', 'ERC-20', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6),
  holding('1', 'ERC-20', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai Stablecoin', 18),
  holding('1', 'ERC-20', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'WBTC', 'Wrapped BTC', 8),
  holding('1', 'ERC-20', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18),
  holding('10', 'ERC-20', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USD Coin', 6),
  holding('10', 'ERC-20', '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),
]

export function createStartingRemoteAssets(now: Date = new Date()): IRemoteAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: now.toISOString(),
    tokens: STARTING_REMOTE_TOKENS,
  }
}

function holding(
  chainId: string,
  standard: 'native' | 'ERC-20',
  address: string | null,
  symbol: string,
  name: string,
  decimals: number,
): IRemoteAssetToken {
  return {
    chainId,
    standard,
    address,
    symbol,
    name,
    decimals,
    balance: '0',
    isVerified: true,
  }
}
