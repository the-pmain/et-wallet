import { useMemo } from 'react'

import type { IPortfolioSummary, ITokenAmount } from '@/core'

import { mapRemoteAssets } from '../lib/map-remote-assets'
import { useDirectorySession } from './directory-session'

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
 * ДВА ЭКРАНА НЕ ДОЛЖНЫ ХОДИТЬ ЗА ДАННЫМИ ПОРОЗНЬ. Иначе после входа
 * главный показал бы локальный ETH с нулём, а «Assets» — витрину
 * записи, и владелец решил бы, что это разные кошельки.
 *
 * ЗАПИСЬ СПРАВОЧНИКА ВАЖНЕЕ СНИМКА СЕССИИ. Пока идёт восстановление
 * входа, список пуст, а не подменяется локальным: мелькнувший чужой
 * ETH хуже короткой пустоты.
 */
export function useDisplayedAssets(local: ILocalAssetSnapshot): IDisplayedAssets {
  const directory = useDirectorySession()
  const mapped = useMemo(
    () => (directory.user === null ? null : mapRemoteAssets(directory.user.assets)),
    [directory.user],
  )
  const isRemote = mapped !== null || directory.isRestoring

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
    isLoading: directory.isRefreshing || directory.isRestoring,
    isRemote: true,
  }
}
