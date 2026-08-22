import { useMemo } from 'react'

import type { ChainId } from '@/core'
import { useDisplayedAssets } from '@/features/onboarding'

import type { ITokenBalance } from './contracts'
import { useWalletSnapshot } from './wallet-context'

interface ISendAssets {
  /** Активы, доступные для отправки в текущей сети. */
  readonly assets: readonly ITokenBalance[]
  readonly isLoading: boolean
  readonly isRemote: boolean

  /** Сеть перевода: активная сеть кошелька или сеть выбранного актива. */
  readonly chainId: ChainId | null
}

/**
 * Список активов для экрана отправки.
 *
 * Берёт тот же источник, что главный экран и раздел Assets: для записи
 * справочника — `users.assets` с сервера, иначе — снимок локальной сессии.
 */
export function useSendAssets(): ISendAssets {
  const snapshot = useWalletSnapshot()
  const displayed = useDisplayedAssets({
    tokens: snapshot.tokenBalances,
    portfolio: snapshot.portfolio,
    isLoading: snapshot.isTokensLoading,
  })

  const activeChainId = snapshot.activeNetwork?.chainId ?? null

  const assets = useMemo((): readonly ITokenBalance[] => {
    const tokens = displayed.tokens

    if (activeChainId === null) {
      return tokens
    }

    return tokens.filter((item) => item.token.chainId === activeChainId)
  }, [activeChainId, displayed.tokens])

  const chainId = activeChainId ?? assets[0]?.token.chainId ?? null

  return {
    assets,
    isLoading: displayed.isLoading,
    isRemote: displayed.isRemote,
    chainId,
  }
}
