import { createContext, useContext } from 'react'

import type { AdminClient } from './AdminClient'

export interface IAdminSession {
  readonly client: AdminClient
  readonly lock: () => void
}

export const AdminSessionContext = createContext<IAdminSession | null>(null)

export function useAdminSession(): IAdminSession {
  const session = useContext(AdminSessionContext)

  if (session === null) {
    throw new Error('useAdminSession must be called inside AdminGate.')
  }

  return session
}
