import { createContext, use, useSyncExternalStore } from 'react'

import type { IWalletSession, IWalletSnapshot } from './contracts'

/**
 * Контекст сессии кошелька.
 *
 * Значения по умолчанию нет намеренно: обращение к сессии вне провайдера —
 * ошибка композиции, и проявиться она должна сразу, а не превратиться
 * в вечно пустой экран.
 */
export const WalletContext = createContext<IWalletSession | null>(null)

/**
 * Доступ к операциям кошелька.
 *
 * @throws Если вызван вне провайдера.
 */
export function useWallet(): IWalletSession {
  const session = use(WalletContext)

  if (session === null) {
    throw new Error('useWallet должен вызываться внутри WalletProvider.')
  }

  return session
}

/**
 * Снимок состояния кошелька с подпиской на изменения.
 *
 * `useSyncExternalStore` требует, чтобы `getSnapshot` возвращал стабильную
 * ссылку между изменениями. Сессия соблюдает это условие: снимок заменяется
 * целиком и только при настоящем изменении данных.
 */
export function useWalletSnapshot(): IWalletSnapshot {
  const session = useWallet()

  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
  )
}
