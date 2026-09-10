import { BUILT_IN_NETWORKS, type Address, type ChainId, type INetworkConfig } from '@/core'

/** Built-in network by id. Missing from the list is `null`, not a made-up record. */
export function networkForChainId(chainId: ChainId): INetworkConfig | null {
  return BUILT_IN_NETWORKS.find((network) => network.chainId === chainId) ?? null
}

/** Chain name for a row label. An unknown chain is its number, not an invention. */
export function networkNameForChainId(chainId: ChainId): string {
  const match = networkForChainId(chainId)

  return match === null ? `Chain ${chainId.toString()}` : match.name
}

/**
 * Asset page URL in the chain explorer.
 *
 * A contract goes to the token page. Native currency has no contract,
 * so this is the explorer root: there is no "ether" page, and inventing
 * a path is forbidden.
 *
 * `null` means no explorer in the config. The link is then not drawn:
 * an empty `href` would look live and go nowhere.
 */
export function tokenExplorerUrl(chainId: ChainId, address: Address | null): string | null {
  const base = networkForChainId(chainId)?.blockExplorerUrls[0]

  if (base === undefined || base === '') {
    return null
  }

  const origin = base.replace(/\/$/u, '')

  return address === null ? origin : `${origin}/token/${address}`
}
