import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useLocation } from 'react-router'

import { type IRemoteSending } from '@/features/onboarding'

import { AdminAuthError } from './AdminClient'
import { useAdminSession } from './admin-context'
import { applyLivePendingEvent, hydratePendingQueue } from './admin-pending-toasts'
import { useAdminSendingsLive } from './admin-sendings-live'

const PENDING_TOAST_PAGE_SIZE = 100

interface IAdminPendingQueue {
  readonly queue: readonly IRemoteSending[]
  readonly setQueue: Dispatch<SetStateAction<readonly IRemoteSending[]>>
  readonly hydrate: (listed: readonly IRemoteSending[]) => void
}

const AdminPendingQueueContext = createContext<IAdminPendingQueue | null>(null)

/**
 * Pending toast queue for the super-admin cabinet.
 *
 * Users and Activity hydrate existing pendings once. Sendings uses
 * its own list. Receivings never GETs sendings — live creates still
 * arrive on the cabinet SSE stream.
 */
export function AdminPendingQueueProvider({ children }: { readonly children: ReactNode }) {
  const { client, lock } = useAdminSession()
  const location = useLocation()
  const [queue, setQueue] = useState<readonly IRemoteSending[]>([])
  const path = location.pathname
  const canHydratePending =
    path === '/admin' || path === '/admin/activity' || path.startsWith('/admin/users/')
  const hydrated = useRef(false)

  const hydrate = useCallback((listed: readonly IRemoteSending[]) => {
    setQueue((current) => hydratePendingQueue(current, listed))
  }, [])

  useEffect(() => {
    if (!canHydratePending || hydrated.current) {
      return
    }

    let cancelled = false

    void client
      .listDirectorySendings({
        page: 1,
        pageSize: PENDING_TOAST_PAGE_SIZE,
        q: '',
        status: 'pending',
      })
      .then((page) => {
        if (!cancelled) {
          hydrated.current = true
          hydrate(page.items)
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()
        }
      })

    return () => {
      cancelled = true
    }
  }, [canHydratePending, client, hydrate, lock])

  useAdminSendingsLive((event) => {
    setQueue((current) => applyLivePendingEvent(current, event))
  })

  const value = useMemo(
    () => ({
      queue,
      setQueue,
      hydrate,
    }),
    [hydrate, queue],
  )

  return (
    <AdminPendingQueueContext.Provider value={value}>{children}</AdminPendingQueueContext.Provider>
  )
}

export function useAdminPendingQueue(): IAdminPendingQueue {
  const queue = useContext(AdminPendingQueueContext)

  if (queue === null) {
    throw new Error('useAdminPendingQueue must be called inside AdminPendingQueueProvider.')
  }

  return queue
}

export function useHydrateAdminPendingSendings(): ((listed: readonly IRemoteSending[]) => void) | null {
  return useContext(AdminPendingQueueContext)?.hydrate ?? null
}
