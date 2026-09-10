import { useEffect } from 'react'

import { useDirectorySession } from './directory-session'
import { readLoginCredentials } from './login-credentials'

/**
 * При входе на экран запрашивает свежую витрину `GET /v1/users/:id`.
 *
 * Баланс после списания перевода живёт в записи справочника.
 * Снимок сессии его не знает, пока этот запрос не вернётся.
 */
export function useRefreshRemoteAssets(): void {
  const directory = useDirectorySession()

  useEffect(() => {
    if (readLoginCredentials() === null) {
      return
    }

    void directory.refresh()
  }, [directory.refresh])
}
