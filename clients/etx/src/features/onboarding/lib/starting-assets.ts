import type { IRemoteAssetToken, IRemoteAssets } from '../model/RemoteUserDirectory'

/**
 * Витрина, которую клиент кладёт в `POST /v1/users`.
 *
 * Одна позиция: нативный ETH в Ethereum, остаток `"0"`.
 * Курса и оценки в объекте нет: их считает экран по снимку рынка.
 */
export const STARTING_REMOTE_TOKENS: readonly IRemoteAssetToken[] = [
  holding('1', 'native', null, 'ETH', 'Ether', 18),
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
