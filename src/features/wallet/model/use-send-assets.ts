import { useMemo } from 'react'

import type { ChainId } from '@/core'
import { useDisplayedAssets } from '@/features/onboarding'

import type { ITokenBalance } from './contracts'
import { useWalletSnapshot } from './wallet-context'

interface ISendAssets {
  /** Assets available to send on the current chain. */
  readonly assets: readonly ITokenBalance[]
  readonly isLoading: boolean
  readonly isRemote: boolean

  /** Transfer chain: the wallet's active network or the selected asset's. */
  readonly chainId: ChainId | null
}

/**
 * Asset list for the send screen.
 *
 * Same source as the home screen and Assets: for a directory record,
 * `users.assets` from the server; otherwise the local session snapshot.
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
