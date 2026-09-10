import { useCallback, useEffect, useState } from 'react'

import { useDirectorySession } from './directory-session'
import { readLoginCredentials } from './login-credentials'
import type { IRemoteSending } from './RemoteUserDirectory'

export interface IUserSendings {
  readonly sendings: readonly IRemoteSending[]
  readonly isLoading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

/**
 * Transfers for the current sign-in: only `GET /v1/users/:id/sendings`.
 *
 * There is no `GET /v1/sendings` stream here: the send screen listens
 * to SSE itself, and Activity is a read-only list.
 */
export function useUserSendings(enabled = true): IUserSendings {
  const directory = useDirectorySession()
  const credentials = readLoginCredentials()
  const userId = directory.user?.id ?? credentials?.id ?? null
  const [sendings, setSendings] = useState<readonly IRemoteSending[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (readLoginCredentials() === null) {
      setError(null)
      return
    }

    try {
      const listed = await directory.listSendings()
      setSendings(listed)
      setError(null)
    } catch {
      setError('The sendings list could not be loaded.')
    }
  }, [directory])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void refresh()
  }, [enabled, refresh, userId])

  return {
    sendings: sendings ?? [],
    isLoading: enabled && userId !== null && sendings === null && error === null,
    error,
    refresh,
  }
}
