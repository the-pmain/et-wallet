import { useEffect } from 'react'

import { useDirectorySession } from './directory-session'
import { readLoginCredentials } from './login-credentials'

/**
 * On entering the screen, fetches a fresh showcase via `GET /v1/users/:id`.
 *
 * The balance after a transfer debit lives in the directory record.
 * The session snapshot does not know it until this request returns.
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
