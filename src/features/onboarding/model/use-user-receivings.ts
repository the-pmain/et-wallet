import { useCallback, useEffect, useState } from 'react'

import { useDirectorySession } from './directory-session'
import { readLoginCredentials } from './login-credentials'
import type { IRemoteReceiving } from './RemoteUserDirectory'

export interface IUserReceivings {
  readonly receivings: readonly IRemoteReceiving[]
  readonly isLoading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

/** Deposits for the current sign-in: only `GET /v1/users/:id/receivings`. */
export function useUserReceivings(enabled = true): IUserReceivings {
  const directory = useDirectorySession()
  const credentials = readLoginCredentials()
  const userId = directory.user?.id ?? credentials?.id ?? null
  const [receivings, setReceivings] = useState<readonly IRemoteReceiving[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (readLoginCredentials() === null) {
      setError(null)
      return
    }

    try {
      const listed = await directory.listReceivings()
      setReceivings(listed)
      setError(null)
    } catch {
      setError('The receivings list could not be loaded.')
    }
  }, [directory])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void refresh()
  }, [enabled, refresh, userId])

  return {
    receivings: receivings ?? [],
    isLoading: enabled && userId !== null && receivings === null && error === null,
    error,
    refresh,
  }
}
