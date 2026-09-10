import type { IRemoteAssetToken, IRemoteAssets } from '../model/RemoteUserDirectory'

/**
 * Showcase the client puts in `POST /v1/users`.
 *
 * One position: native ETH on Ethereum, balance `"0"`.
 * The object has no quote or valuation: the screen computes those
 * from the market snapshot.
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
