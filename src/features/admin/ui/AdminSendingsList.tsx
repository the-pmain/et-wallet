import { Pencil, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  useSendingsSse,
  type IRemoteSending,
  type ISendingSseEvent,
} from '@/features/onboarding'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Alert, AlertDescription, Button, EmptyState, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError, type IAdminSendingPatch } from '../model/AdminClient'
import { addableAssetBySymbol } from '../model/addable-assets'
import { useAdminSession } from '../model/admin-context'
import { sendingMatchesAdminQuery } from '../model/sending-query'
import { SendingEditDialog } from './SendingEditDialog'
import { SendingStatusBadge } from './SendingStatusBadge'

/**
 * Список переводов кабинета.
 *
 * При входе читает `GET /v1/admin/sendings`, затем держит
 * `GET /v1/sendings`: кадр `type_send: create` дописывает строку.
 */
export function AdminSendingsList() {
  const { client, lock } = useAdminSession()
  const [sendings, setSendings] = useState<readonly IRemoteSending[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<IRemoteSending | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void client
      .listSendings()
      .then((listed) => {
        if (!cancelled) {
          setSendings(listed)
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

    return () => {
      cancelled = true
    }
  }, [client, lock])

  useSendingsSse(null, (event) => {
    setSendings((current) => upsertSending(current ?? [], event))
  })

  const filtered = useMemo(() => {
    if (sendings === null) {
      return []
    }

    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return sendings
    }

    return sendings.filter((sending) => sendingMatchesAdminQuery(sending, needle))
  }, [query, sendings])

  async function saveSending(id: string, patch: IAdminSendingPatch): Promise<void> {
    setSaving(true)
    setEditError(null)

    try {
      const updated = await client.updateSending(id, patch)
      setSendings((current) => upsertSending(current ?? [], updated))
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

  if (sendings === null) {
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
          {String(sendings.length)} {sendings.length === 1 ? 'record' : 'records'} in the directory.
        </p>
      </div>
      <Input
        type="search"
        value={query}
        placeholder="Search address, user, amount, symbol or status"
        aria-label="Search address, user, amount, symbol or status"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      {filtered.length === 0 ? (
        sendings.length === 0 ? (
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
          {filtered.map((sending) => (
            <SendingRow
              key={sending.id}
              sending={sending}
              onEdit={() => {
                setEditError(null)
                setEditing(sending)
              }}
            />
          ))}
        </ul>
      )}
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
    </div>
  )
}

function SendingRow({
  sending,
  onEdit,
}: {
  readonly sending: IRemoteSending
  readonly onEdit: () => void
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
          <span className="break-all font-mono text-xs text-foreground">
            {sending.recipientAddress ?? '—'}
          </span>
          <span className="text-2xl font-semibold tabular-nums tracking-tight">
            {sending.amount ?? '—'}
          </span>
          <span className="text-xs text-muted-foreground">
            id {sending.id} · user {sending.userId ?? '—'}
            {sending.failureMessage !== null && sending.failureMessage !== ''
              ? ` · ${sending.failureMessage}`
              : null}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <SendingTimestamp value={sending.createdAt} />
        <SendingStatusBadge status={sending.status} />
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          Edit
        </Button>
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
      <span className="text-base font-semibold tabular-nums tracking-tight">{clock}</span>
      <span className="text-sm font-medium text-foreground/80">{day}</span>
    </time>
  )
}

function upsertSending(
  current: readonly IRemoteSending[],
  incoming: IRemoteSending | ISendingSseEvent,
): readonly IRemoteSending[] {
  const next: IRemoteSending = {
    id: incoming.id,
    createdAt: incoming.createdAt,
    userId: incoming.userId,
    status: incoming.status,
    failureMessage: incoming.failureMessage,
    recipientAddress: incoming.recipientAddress,
    amount: incoming.amount,
    symbol: incoming.symbol,
  }
  const index = current.findIndex((item) => item.id === next.id)

  if (index === -1) {
    return [next, ...current]
  }

  return current.map((item, position) => (position === index ? next : item))
}
