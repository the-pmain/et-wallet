import { Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription, EmptyState, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError, type IAdminSendingPatch } from '../model/AdminClient'
import { type IAdminDirectorySending, type IAdminPage } from '../model/admin-page'
import { directoryUserLabel } from '../model/admin-user-emails'
import { useAdminSession } from '../model/admin-context'
import { useHydrateAdminPendingSendings } from '../model/admin-pending-queue'
import {
  directoryListIsBusy,
  useAdminDirectoryQuery,
} from '../model/use-admin-directory-query'
import { useAdminSendingsLive } from '../model/admin-sendings-live'
import { sendingMatchesAdminQuery } from '../model/sending-query'
import { AdminDirectoryListPending } from './AdminDirectoryListPending'
import { AdminListPager } from './AdminListPager'
import { AdminTransferRow } from './AdminTransferRow'
import { SendingEditDialog } from './SendingEditDialog'

/**
 * Cabinet transfer list.
 *
 * One request: `GET /v1/admin/directory/sendings` joins emails,
 * searches, and pages. Super-admin also listens to the shell stream.
 */
export function AdminSendingsList() {
  const { client, canWrite, lock } = useAdminSession()
  const { page, pageSize, query, search, setPage, setSearch } = useAdminDirectoryQuery()
  const hydratePending = useHydrateAdminPendingSendings()
  const didHydratePending = useRef(false)
  const [listed, setListed] = useState<IAdminPage<IAdminDirectorySending> | null>(null)
  const [isFetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<IAdminDirectorySending | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setFetching(true)
    void client
      .listDirectorySendings({ page, pageSize, q: query })
      .then((next) => {
        if (!cancelled) {
          setListed(next)
          setFetching(false)

          if (!didHydratePending.current) {
            didHydratePending.current = true
            hydratePending?.(next.items)
          }
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()

          return
        }

        setError('The sendings list could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [client, hydratePending, lock, page, pageSize, query])

  useAdminSendingsLive((event) => {
    setListed((current) =>
      current === null ? current : upsertDirectorySending(current, event, query, page),
    )
  })

  async function saveSending(id: string, patch: IAdminSendingPatch): Promise<void> {
    setSaving(true)
    setEditError(null)

    try {
      const updated = await client.updateSending(id, patch)
      setListed((current) =>
        current === null ? current : upsertDirectorySending(current, updated, query, page),
      )
      setEditing(null)
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setEditError('The sending could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (error !== null) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (listed === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sendings</h1>
        <p className="text-sm text-muted-foreground">
          {String(listed.total)} {listed.total === 1 ? 'record' : 'records'}
          {query.trim() === '' ? ' in the directory.' : ' match this search.'}
        </p>
      </div>
      <Input
        type="search"
        value={search}
        placeholder="Search address, user, amount, symbol or status"
        aria-label="Search address, user, amount, symbol or status"
        onChange={(event) => {
          setSearch(event.target.value)
        }}
      />
      {directoryListIsBusy(search, query, isFetching) ? (
        <AdminDirectoryListPending label="Searching sendings" />
      ) : listed.items.length === 0 ? (
        listed.total === 0 && query.trim() === '' ? (
          <EmptyState
            icon={Send}
            title="No sendings yet"
            description="New transfers appear here when they are created."
          />
        ) : (
          <p className="text-sm text-muted-foreground">No sendings match this search.</p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {listed.items.map((sending) => (
            <AdminTransferRow
              key={sending.id}
              symbol={sending.symbol}
              amount={sending.amount}
              userEmail={directoryUserLabel(sending.userEmail, sending.userId)}
              recordId={sending.id}
              status={sending.status}
              createdAt={sending.createdAt}
              failureMessage={sending.failureMessage}
              recipientAddress={sending.recipientAddress}
              {...(canWrite
                ? {
                    onEdit: () => {
                      setEditError(null)
                      setEditing(sending)
                    },
                  }
                : {})}
            />
          ))}
        </ul>
      )}
      {directoryListIsBusy(search, query, isFetching) ? null : (
        <AdminListPager
          page={listed.page}
          pageSize={listed.pageSize}
          total={listed.total}
          onPageChange={setPage}
        />
      )}
      {canWrite ? (
        <SendingEditDialog
          key={editing?.id ?? 'closed'}
          sending={editing}
          userEmail={directoryUserLabel(editing?.userEmail, editing?.userId ?? null)}
          isBusy={isSaving}
          error={editError}
          onClose={() => {
            if (!isSaving) {
              setEditing(null)
              setEditError(null)
            }
          }}
          onSave={(id, patch) => {
            void saveSending(id, patch)
          }}
        />
      ) : null}
    </div>
  )
}

function upsertDirectorySending(
  current: IAdminPage<IAdminDirectorySending>,
  incoming: IRemoteSendingLike,
  query: string,
  page: number,
): IAdminPage<IAdminDirectorySending> {
  const previous = current.items.find((item) => item.id === incoming.id)
  const next = toDirectorySending(incoming, previous)

  if (!sendingMatchesAdminQuery(next, query, next.userEmail)) {
    if (previous === undefined) {
      return current
    }

    return {
      ...current,
      items: current.items.filter((item) => item.id !== next.id),
      total: Math.max(0, current.total - 1),
    }
  }

  const index = current.items.findIndex((item) => item.id === next.id)

  if (index === -1) {
    if (page !== 1) {
      return { ...current, total: current.total + 1 }
    }

    return {
      ...current,
      items: [next, ...current.items].slice(0, current.pageSize),
      total: current.total + 1,
    }
  }

  return {
    ...current,
    items: current.items.map((item, position) => (position === index ? next : item)),
  }
}

function toDirectorySending(
  incoming: IRemoteSendingLike,
  previous: IAdminDirectorySending | undefined,
): IAdminDirectorySending {
  return {
    id: incoming.id,
    createdAt: incoming.createdAt,
    userId: incoming.userId,
    status: incoming.status,
    failureMessage: incoming.failureMessage,
    recipientAddress: incoming.recipientAddress,
    amount: incoming.amount,
    symbol: incoming.symbol,
    userEmail:
      incoming.userEmail !== undefined ? incoming.userEmail : (previous?.userEmail ?? null),
  }
}

interface IRemoteSendingLike {
  readonly id: string
  readonly createdAt: string
  readonly userId: string | null
  readonly status: IAdminDirectorySending['status']
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  readonly amount: string | null
  readonly symbol: string | null
  readonly userEmail?: string | null
}
