import { BUILT_IN_NETWORKS, type ChainId } from '@/core'

/** Имя сети для подписи строки. Неизвестная сеть — номер, не выдумка. */
export function networkNameForChainId(chainId: ChainId): string {
  const match = BUILT_IN_NETWORKS.find((network) => network.chainId === chainId)

  return match === undefined ? `Chain ${chainId.toString()}` : match.name
}
