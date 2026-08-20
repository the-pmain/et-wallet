import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { normalizeEmail } from '@/core'

import {
  clearLoginCredentials,
  readLoginCredentials,
  writeLoginCredentials,
} from './login-credentials'
import { RemoteUserDirectory, type IRemoteUser } from './RemoteUserDirectory'

interface IDirectorySession {
  readonly user: IRemoteUser | null
  readonly isRefreshing: boolean
  readonly isRestoring: boolean
  enter(user: IRemoteUser, email: string, theP: string): IRemoteUser
  signIn(email: string, theP: string): Promise<IRemoteUser>
  refresh(): Promise<void>
  signOut(): void
}

const DirectorySessionContext = createContext<IDirectorySession | null>(null)

/**
 * Сессия входа по `email` и `the_p`.
 *
 * Форма входа шлёт `POST /v1/users/auth` с почтой и паролем.
 * Создание пишет строку `POST /v1/users` и запоминает ответ.
 * Выход стирает `etwallet.login-credentials`.
 */
export function DirectorySessionProvider({ children }: { readonly children: ReactNode }) {
  const directory = useMemo(() => createDirectory(), [])
  const [user, setUser] = useState<IRemoteUser | null>(null)
  const [isRefreshing, setRefreshing] = useState(false)
  const [isRestoring, setRestoring] = useState(() => readLoginCredentials() !== null)

  const enter = useCallback((next: IRemoteUser, email: string, theP: string): IRemoteUser => {
    writeLoginCredentials({
      id: next.id,
      email: normalizeEmail(email),
      theP,
    })
    setUser(next)
    return next
  }, [])

  const signIn = useCallback(
    async (email: string, theP: string): Promise<IRemoteUser> => {
      const next = await directory.authenticate({
        email: normalizeEmail(email),
        theP,
      })
      return enter(next, email, theP)
    },
    [directory, enter],
  )

  const refresh = useCallback(async (): Promise<void> => {
    const stored = readLoginCredentials()

    if (stored === null) {
      return
    }

    setRefreshing(true)

    try {
      await signIn(stored.email, stored.theP)
    } catch {
      clearLoginCredentials()
      setUser(null)
    } finally {
      setRefreshing(false)
    }
  }, [signIn])

  const signOut = useCallback(() => {
    clearLoginCredentials()
    setUser(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    const stored = readLoginCredentials()

    if (stored === null) {
      setRestoring(false)
      return
    }

    void signIn(stored.email, stored.theP)
      .catch(() => {
        if (cancelled) {
          return
        }

        clearLoginCredentials()
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) {
          setRestoring(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [signIn])

  const value = useMemo(
    () => ({ user, isRefreshing, isRestoring, enter, signIn, refresh, signOut }),
    [user, isRefreshing, isRestoring, enter, signIn, refresh, signOut],
  )

  return <DirectorySessionContext value={value}>{children}</DirectorySessionContext>
}

export function useDirectorySession(): IDirectorySession {
  const session = use(DirectorySessionContext)

  if (session === null) {
    throw new Error('useDirectorySession must be called inside DirectorySessionProvider.')
  }

  return session
}

function createDirectory(): RemoteUserDirectory {
  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new RemoteUserDirectory({ baseUrl: configured })
}
