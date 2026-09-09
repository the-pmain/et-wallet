import { ArrowDownToLine, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { IRemoteReceiving } from '@/features/onboarding'
import { AmountWithUnit } from '@/features/wallet/ui/AmountWithUnit'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Alert, AlertDescription, Button, EmptyState, Input, Skeleton } from '@/shared/ui'

import { AdminAuthError, type IAdminReceivingPatch } from '../model/AdminClient'
import { formatStoredUsdAmount } from '../lib/asset-usd-input'
import { addableAssetBySymbol } from '../model/addable-assets'
import { useAdminSession } from '../model/admin-context'
import { sendingMatchesAdminQuery } from '../model/sending-query'
import { ReceivingEditDialog } from './ReceivingEditDialog'
import { SendingStatusBadge } from './SendingStatusBadge'

/** Cabinet deposit list. Regular admins view; super-admins edit. */
export function AdminReceivingsList() {
  const { client, canWrite, lock } = useAdminSession()
  const [receivings, setReceivings] = useState<readonly IRemoteReceiving[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<IRemoteReceiving | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void client
      .listReceivings()
      .then((listed) => {
        if (!cancelled) {
          setReceivings(listed)
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

    return () => {
      cancelled = true
    }
  }, [client, lock])

  const filtered = useMemo(() => {
    if (receivings === null) {
      return []
    }

    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return receivings
    }

    return receivings.filter((receiving) => sendingMatchesAdminQuery(receiving, needle))
  }, [query, receivings])

  async function saveReceiving(id: string, patch: IAdminReceivingPatch): Promise<void> {
    setSaving(true)
    setEditError(null)

    try {
      const updated = await client.updateReceiving(id, patch)
      setReceivings((current) => upsertReceiving(current ?? [], updated))
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

  if (receivings === null) {
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
          {String(receivings.length)} {receivings.length === 1 ? 'record' : 'records'} in the
          directory.
        </p>
      </div>
      <Input
        type="search"
        value={query}
        placeholder="Search user, amount, symbol or status"
        aria-label="Search user, amount, symbol or status"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      {filtered.length === 0 ? (
        receivings.length === 0 ? (
          <EmptyState
            icon={ArrowDownToLine}
            title="No receivings yet"
            description="New deposits appear here when an asset status is set on a user."
          />
        ) : (
          <p className="text-sm text-muted-foreground">No receivings match this search.</p>
        )
      ) : (
        <ul className="divide-y rounded-xl border">
          {filtered.map((receiving) => (
            <ReceivingRow
              key={receiving.id}
              receiving={receiving}
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
      {canWrite ? (
        <ReceivingEditDialog
          key={editing?.id ?? 'closed'}
          receiving={editing}
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

function ReceivingRow({
  receiving,
  onEdit,
}: {
  readonly receiving: IRemoteReceiving
  readonly onEdit?: () => void
}) {
  const asset = addableAssetBySymbol(receiving.symbol)
  const symbol = receiving.symbol ?? asset?.token.symbol ?? '—'
  const name = asset?.token.name ?? receiving.symbol ?? 'Unknown asset'
  const network = asset?.chainName ?? 'Unknown network'
  const usdLabel = formatStoredUsdAmount(receiving.usdAmount)

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
          <AmountWithUnit
            amount={receiving.amount === null || receiving.amount === '' ? '—' : receiving.amount}
            unit={symbol === '—' ? '' : symbol}
            className="text-2xl font-semibold tracking-tight"
          />
          {usdLabel === null ? null : (
            <span className="text-sm tabular-nums text-muted-foreground">{usdLabel}</span>
          )}
          {receiving.failureMessage !== null && receiving.failureMessage !== '' ? (
            <span className="text-sm break-words text-destructive">{receiving.failureMessage}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            id {receiving.id} · user {receiving.userId ?? '—'}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <SendingStatusBadge status={receiving.status} />
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

function upsertReceiving(
  current: readonly IRemoteReceiving[],
  incoming: IRemoteReceiving,
): readonly IRemoteReceiving[] {
  const index = current.findIndex((item) => item.id === incoming.id)

  if (index === -1) {
    return [incoming, ...current]
  }

  return current.map((item, position) => (position === index ? incoming : item))
}
