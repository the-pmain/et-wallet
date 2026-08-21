import { BUILT_IN_NETWORKS, listVerifiedTokens, toChainId, type ChainId } from '@/core'
import type { IRemoteAssetToken } from '@/features/onboarding/model/RemoteUserDirectory'

/**
 * Криптовалюта, которую кабинет может дописать в витрину `assets`.
 *
 * Источник — встроенные сети и проверенные контракты. Произвольный
 * адрес сюда не попадает: знак в списке выдаётся только по этой паре
 * «сеть и адрес», и чужой контракт с тем же тикером знака не получит.
 */
export interface IAddableAsset {
  readonly id: string
  readonly chainId: ChainId
  readonly chainName: string
  readonly token: IRemoteAssetToken
}

/** Ключ позиции: сеть и адрес, без учёта регистра адреса. */
export function remoteAssetKey(token: Pick<IRemoteAssetToken, 'chainId' | 'address'>): string {
  return `${token.chainId}:${token.address === null ? 'native' : token.address.toLowerCase()}`
}

/** Имя сети для подписи строки. Неизвестная сеть — номер, не выдумка. */
export function networkNameForChain(chainId: string): string {
  const match = BUILT_IN_NETWORKS.find((network) => network.chainId.toString() === chainId)

  return match === undefined ? `Chain ${chainId}` : match.name
}

/** Идентификатор сети для знака. Битая строка — `null`, список не падает. */
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
 * Список криптовалют в меню добавления.
 *
 * Порядок как у сетей: сначала нативная валюта, затем проверенные
 * контракты этой сети. Повторных ключей нет — это свойство сборки,
 * а не фильтра при открытии меню.
 */
export const ADDABLE_ASSETS: readonly IAddableAsset[] = buildAddableAssets()
