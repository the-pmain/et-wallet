import { useMemo } from 'react'

import type { IPortfolioSummary, ITokenAmount } from '@/core'

import { mapRemoteAssets } from '../lib/map-remote-assets'
import { useDirectorySession } from './directory-session'
import { readLoginCredentials } from './login-credentials'
import { useRemoteAssetQuotes } from './use-remote-asset-quotes'

/** Локальный снимок, которым пользуются, пока записи справочника нет. */
export interface ILocalAssetSnapshot {
  readonly tokens: readonly ITokenAmount[]
  readonly portfolio: IPortfolioSummary | null
  readonly isLoading: boolean
}

/** Список, который рисуют экран активов и карточка на главном. */
export interface IDisplayedAssets {
  readonly tokens: readonly ITokenAmount[]
  readonly portfolio: IPortfolioSummary | null
  readonly isLoading: boolean
  readonly isRemote: boolean
}

/**
 * Один источник строк для экрана активов и для карточки на главном.
 *
 * ЗАПИСЬ СПРАВОЧНИКА ВАЖНЕЕ СНИМКА СЕССИИ. Курсы для неё берутся
 * из снимка рынка, загруженного при открытии приложения.
 */
export function useDisplayedAssets(local: ILocalAssetSnapshot): IDisplayedAssets {
  const directory = useDirectorySession()
  const remoteTokens = directory.user?.assets.tokens ?? []
  const { quotes, isLoading: isQuotesLoading } = useRemoteAssetQuotes(
    directory.user === null ? [] : remoteTokens,
  )
  const mapped = useMemo(
    () => (directory.user === null ? null : mapRemoteAssets(directory.user.assets, quotes)),
    [directory.user, quotes],
  )
  const isRemote =
    mapped !== null || directory.isRestoring || readLoginCredentials() !== null

  if (!isRemote) {
    return {
      tokens: local.tokens,
      portfolio: local.portfolio,
      isLoading: local.isLoading,
      isRemote: false,
    }
  }

  return {
    tokens: mapped?.tokens ?? [],
    portfolio: mapped?.portfolio ?? null,
    isLoading: directory.isRefreshing || directory.isRestoring || isQuotesLoading,
    isRemote: true,
  }
}
