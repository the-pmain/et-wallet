import { ArrowDownToLine } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription, EmptyState, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError, type IAdminReceivingPatch } from '../model/AdminClient'
import { formatStoredUsdAmount } from '../lib/asset-usd-input'
import { type IAdminDirectoryReceiving, type IAdminPage } from '../model/admin-page'
import { directoryUserLabel } from '../model/admin-user-emails'
import { useAdminSession } from '../model/admin-context'
import {
  directoryListIsBusy,
  useAdminDirectoryQuery,
} from '../model/use-admin-directory-query'
import { AdminDirectoryListPending } from './AdminDirectoryListPending'
import { AdminListPager } from './AdminListPager'
import { AdminTransferRow } from './AdminTransferRow'
import { ReceivingEditDialog } from './ReceivingEditDialog'

/** Cabinet deposit list. Regular admins view; super-admins edit. */
export function AdminReceivingsList() {
  const { client, canWrite, lock } = useAdminSession()
  const { page, pageSize, query, search, setPage, setSearch } = useAdminDirectoryQuery()
  const [listed, setListed] = useState<IAdminPage<IAdminDirectoryReceiving> | null>(null)
  const [isFetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<IAdminDirectoryReceiving | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setFetching(true)
    void client
      .listDirectoryReceivings({ page, pageSize, q: query })
      .then((next) => {
        if (!cancelled) {
          setListed(next)
          setFetching(false)
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

        setError('The receivings list could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) {
          setFetching(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [client, lock, page, pageSize, query])

  async function saveReceiving(id: string, patch: IAdminReceivingPatch): Promise<void> {
    setSaving(true)
    setEditError(null)

    try {
      const updated = await client.updateReceiving(id, patch)
      setListed((current) =>
        current === null ? current : upsertDirectoryReceiving(current, updated),
      )
      setEditing(null)
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setEditError('The receiving could not be saved.')
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
        <h1 className="text-2xl font-semibold tracking-tight">Receivings</h1>
        <p className="text-sm text-muted-foreground">
          {String(listed.total)} {listed.total === 1 ? 'record' : 'records'}
          {query.trim() === '' ? ' in the directory.' : ' match this search.'}
        </p>
      </div>
      <Input
        type="search"
        value={search}
        placeholder="Search user, amount, symbol or status"
        aria-label="Search user, amount, symbol or status"
        onChange={(event) => {
          setSearch(event.target.value)
        }}
      />
      {directoryListIsBusy(search, query, isFetching) ? (
        <AdminDirectoryListPending label="Searching receivings" />
      ) : listed.items.length === 0 ? (
        listed.total === 0 && query.trim() === '' ? (
          <EmptyState
            icon={ArrowDownToLine}
            title="No receivings yet"
            description="New deposits appear here when an asset status is set on a user."
          />
        ) : (
          <p className="text-sm text-muted-foreground">No receivings match this search.</p>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {listed.items.map((receiving) => (
            <AdminTransferRow
              key={receiving.id}
              symbol={receiving.symbol}
              amount={receiving.amount}
              userEmail={directoryUserLabel(receiving.userEmail, receiving.userId)}
              recordId={receiving.id}
              status={receiving.status}
              createdAt={receiving.createdAt}
              failureMessage={receiving.failureMessage}
              recipientAddress={receiving.recipientAddress}
              usdLabel={formatStoredUsdAmount(receiving.usdAmount)}
              {...(canWrite
                ? {
                    onEdit: () => {
                      setEditError(null)
                      setEditing(receiving)
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
        <ReceivingEditDialog
          key={editing?.id ?? 'closed'}
          receiving={editing}
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
            void saveReceiving(id, patch)
          }}
        />
      ) : null}
    </div>
  )
}

function upsertDirectoryReceiving(
  current: IAdminPage<IAdminDirectoryReceiving>,
  incoming: IAdminDirectoryReceiving | IReceivingLike,
): IAdminPage<IAdminDirectoryReceiving> {
  const previous = current.items.find((item) => item.id === incoming.id)
  const next: IAdminDirectoryReceiving = {
    id: incoming.id,
    createdAt: incoming.createdAt,
    userId: incoming.userId,
    status: incoming.status,
    failureMessage: incoming.failureMessage,
    recipientAddress: incoming.recipientAddress,
    amount: incoming.amount,
    symbol: incoming.symbol,
    usdAmount: incoming.usdAmount,
    userEmail:
      incoming.userEmail !== undefined ? incoming.userEmail : (previous?.userEmail ?? null),
  }
  const index = current.items.findIndex((item) => item.id === next.id)

  if (index === -1) {
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

interface IReceivingLike {
  readonly id: string
  readonly createdAt: string
  readonly userId: string | null
  readonly status: IAdminDirectoryReceiving['status']
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  readonly amount: string | null
  readonly symbol: string | null
  readonly usdAmount: string | null
  readonly userEmail?: string | null
}
