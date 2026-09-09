import { Pencil, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { type IRemoteSending, type ISendingSseEvent } from '@/features/onboarding'
import { AmountWithUnit } from '@/features/wallet/ui/AmountWithUnit'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Alert, AlertDescription, Button, EmptyState, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError, type IAdminSendingPatch } from '../model/AdminClient'
import { addableAssetBySymbol } from '../model/addable-assets'
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
import { SendingEditDialog } from './SendingEditDialog'
import { SendingStatusBadge } from './SendingStatusBadge'

/**
 * Список переводов кабинета.
 *
 * Одна страница: `GET /v1/admin/directory/sendings` уже склеивает
 * email, ищет и режет. Super-admin ещё слушает поток оболочки.
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
        <ul className="divide-y rounded-xl border">
          {listed.items.map((sending) => (
            <SendingRow
              key={sending.id}
              sending={sending}
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

function SendingRow({
  sending,
  onEdit,
}: {
  readonly sending: IAdminDirectorySending
  readonly onEdit?: () => void
}) {
  const asset = addableAssetBySymbol(sending.symbol)
  const symbol = sending.symbol ?? asset?.token.symbol ?? '—'
  const name = asset?.token.name ?? sending.symbol ?? 'Unknown asset'
  const network = asset?.chainName ?? 'Unknown network'

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-start gap-3">
        <TokenAvatar
          address={asset?.token.address ?? null}
          symbol={symbol}
          chainId={asset?.chainId ?? null}
          className="size-8"
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{symbol}</span>
            <span className="truncate text-xs text-muted-foreground">
              {name} · {network}
            </span>
          </span>
          <span className="font-mono text-xs break-all text-foreground">
            {sending.recipientAddress ?? '—'}
          </span>
          <AmountWithUnit
            amount={sending.amount === null || sending.amount === '' ? '—' : sending.amount}
            unit={symbol === '—' ? '' : symbol}
            className="text-2xl font-semibold tracking-tight"
          />
          {sending.failureMessage !== null && sending.failureMessage !== '' ? (
            <span className="text-sm break-words text-destructive">{sending.failureMessage}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            id {sending.id} · user {directoryUserLabel(sending.userEmail, sending.userId)}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <SendingTimestamp value={sending.createdAt} />
        <SendingStatusBadge status={sending.status} />
        {onEdit === undefined ? null : (
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
        )}
      </span>
    </li>
  )
}

function SendingTimestamp({ value }: { readonly value: string }) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return (
      <time dateTime={value} className="text-sm font-semibold">
        {value}
      </time>
    )
  }

  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const day = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <time dateTime={value} className="flex flex-col items-end leading-tight">
      <span className="text-base font-semibold tracking-tight tabular-nums">{clock}</span>
      <span className="text-sm font-medium text-foreground/80">{day}</span>
    </time>
  )
}

function upsertDirectorySending(
  current: IAdminPage<IAdminDirectorySending>,
  incoming: IRemoteSending | ISendingSseEvent,
  query: string,
  page: number,
): IAdminPage<IAdminDirectorySending> {
  const previous = current.items.find((item) => item.id === incoming.id)
  const next: IAdminDirectorySending = {
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
