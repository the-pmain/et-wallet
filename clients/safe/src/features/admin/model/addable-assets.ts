import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, listVerifiedTokens, toChainId, type ChainId } from '@/core'
import type { IRemoteAssetToken } from '@/features/onboarding/model/RemoteUserDirectory'

/**
 * A cryptocurrency the cabinet can add to the `assets` showcase.
 *
 * Source is built-in networks and verified contracts. An arbitrary
 * address does not land here: the mark in the list is issued only
 * for this network-and-address pair, and a foreign contract with
 * the same ticker will not get the mark.
 */
export interface IAddableAsset {
  readonly id: string
  readonly chainId: ChainId
  readonly chainName: string
  readonly token: IRemoteAssetToken
}

/** Position key: network and address, address case-insensitive. */
export function remoteAssetKey(token: Pick<IRemoteAssetToken, 'chainId' | 'address'>): string {
  return `${token.chainId}:${token.address === null ? 'native' : token.address.toLowerCase()}`
}

/** Network name for the row label. An unknown network is a number, not an invention. */
export function networkNameForChain(chainId: string): string {
  const match = BUILT_IN_NETWORKS.find((network) => network.chainId.toString() === chainId)

  return match === undefined ? `Chain ${chainId}` : match.name
}

/** Network id for the mark. A broken string is `null`; the list does not crash. */
export function parseRemoteChainId(chainId: string): ChainId | null {
  try {
    return toChainId(chainId)
  } catch {
    return null
  }
}

function nativeAsset(network: (typeof BUILT_IN_NETWORKS)[number]): IAddableAsset {
  return {
    id: remoteAssetKey({ chainId: network.chainId.toString(), address: null }),
    chainId: network.chainId,
    chainName: network.name,
    token: {
      chainId: network.chainId.toString(),
      standard: 'native',
      address: null,
      symbol: network.nativeCurrency.symbol,
      name: network.nativeCurrency.name,
      decimals: network.nativeCurrency.decimals,
      balance: '0',
      isVerified: true,
    },
  }
}

function verifiedAsset(
  network: (typeof BUILT_IN_NETWORKS)[number],
  token: ReturnType<typeof listVerifiedTokens>[number],
): IAddableAsset {
  return {
    id: remoteAssetKey({ chainId: token.chainId.toString(), address: token.address }),
    chainId: token.chainId,
    chainName: network.name,
    token: {
      chainId: token.chainId.toString(),
      standard: 'ERC-20',
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      balance: '0',
      isVerified: true,
    },
  }
}

function buildAddableAssets(): readonly IAddableAsset[] {
  const items: IAddableAsset[] = []

  for (const network of BUILT_IN_NETWORKS) {
    items.push(nativeAsset(network))

    for (const token of listVerifiedTokens(network.chainId)) {
      items.push(verifiedAsset(network, token))
    }
  }

  return items
}

/**
 * Cryptocurrencies in the add menu.
 *
 * Order matches the networks: native currency first, then that
 * network's verified contracts. Duplicate keys do not exist — a
 * property of the build, not a filter when the menu opens.
 */
export const ADDABLE_ASSETS: readonly IAddableAsset[] = buildAddableAssets()

/**
 * Showcase row by ticker from `sendings.symbol`.
 *
 * One ticker can exist on several networks. The cabinet prefers
 * Ethereum, then the first match — otherwise there would be no
 * mark at all.
 */
export function addableAssetBySymbol(symbol: string | null): IAddableAsset | null {
  if (symbol === null) {
    return null
  }

  const needle = symbol.trim().toUpperCase()

  if (needle === '') {
    return null
  }

  const matches = ADDABLE_ASSETS.filter((item) => item.token.symbol.toUpperCase() === needle)

  return matches.find((item) => item.chainId === BUILT_IN_CHAIN_ID.Ethereum) ?? matches[0] ?? null
}
