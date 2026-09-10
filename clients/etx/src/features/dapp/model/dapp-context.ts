import { createContext, use } from 'react'

import type { IDappSnapshot } from './DappSessionService'

/** Пустое состояние: подключений нет и транспорт не поднят. */
const EMPTY: IDappSnapshot = {
  isReady: false,
  error: null,
  sessions: [],
  proposal: null,
  request: null,
}

/** Значение контекста подключений. */
export interface IDappContextValue {
  readonly snapshot: IDappSnapshot

  readonly init: () => Promise<void>
  readonly pair: (uri: string) => Promise<void>
  readonly respondToProposal: (isApproved: boolean) => Promise<void>
  readonly respondToRequest: (isApproved: boolean) => Promise<void>
  readonly disconnect: (sessionId: string) => Promise<void>
}

/**
 * Контекст подключений к приложениям.
 *
 * ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ НИЧЕГО НЕ ОДОБРЯЕТ. Компонент вне провайдера
 * получает пустое состояние и действия, которые ничего не делают.
 * Обратное — «вне провайдера всё разрешено» — превратило бы забытый
 * провайдер в тихое согласие на подпись.
 */
export const DappContext = createContext<IDappContextValue>({
  snapshot: EMPTY,
  init: () => Promise.resolve(),
  pair: () => Promise.resolve(),
  respondToProposal: () => Promise.resolve(),
  respondToRequest: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
})

/** Доступ к подключениям. */
export function useDapp(): IDappContextValue {
  return use(DappContext)
}
