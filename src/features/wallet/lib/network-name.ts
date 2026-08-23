import { BUILT_IN_NETWORKS, type Address, type ChainId, type INetworkConfig } from '@/core'

/** Встроенная сеть по номеру. Нет в списке — `null`, не выдуманная запись. */
export function networkForChainId(chainId: ChainId): INetworkConfig | null {
  return BUILT_IN_NETWORKS.find((network) => network.chainId === chainId) ?? null
}

/** Имя сети для подписи строки. Неизвестная сеть — номер, не выдумка. */
export function networkNameForChainId(chainId: ChainId): string {
  const match = networkForChainId(chainId)

  return match === null ? `Chain ${chainId.toString()}` : match.name
}

/**
 * Адрес страницы актива в обозревателе сети.
 *
 * У контракта — страница токена. У нативной валюты контракта нет,
 * поэтому ведёт на корень обозревателя: отдельной страницы «эфира»
 * у обозревателя нет, и выдумывать путь нельзя.
 *
 * `null` — обозревателя в конфигурации нет. Ссылка тогда не рисуется:
 * пустой `href` выглядел бы рабочей, а никуда не вёл.
 */
export function tokenExplorerUrl(chainId: ChainId, address: Address | null): string | null {
  const base = networkForChainId(chainId)?.blockExplorerUrls[0]

  if (base === undefined || base === '') {
    return null
  }

  const origin = base.replace(/\/$/u, '')

  return address === null ? origin : `${origin}/token/${address}`
}
