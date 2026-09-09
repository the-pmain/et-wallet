import { ArrowDownToLine } from 'lucide-react'

import { formatStoredUsdAmount } from '@/features/admin/lib/asset-usd-input'
import { addableAssetBySymbol } from '@/features/admin/model/addable-assets'
import { SendingStatusBadge } from '@/features/admin/ui/SendingStatusBadge'
import { AmountWithUnit } from '@/features/wallet/ui/AmountWithUnit'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Alert, AlertDescription, EmptyState, Skeleton } from '@/shared/ui'

import type { IRemoteReceiving } from '../model/RemoteUserDirectory'

/**
 * Directory deposit list. View only: rows are not clickable.
 */
export function UserReceivingsList({
  receivings,
  isLoading,
  error,
  compact = false,
}: {
  readonly receivings: readonly IRemoteReceiving[]
  readonly isLoading: boolean
  readonly error: string | null
  readonly compact?: boolean
}) {
  if (error !== null) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (isLoading) {
    return <ReceivingListSkeleton compact={compact} />
  }

  if (receivings.length === 0) {
    if (compact) {
      return <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">No receivings yet</p>
    }

    return (
      <EmptyState
        icon={ArrowDownToLine}
        title="No receivings yet"
        description="Deposits assigned to this account appear here. They are only for viewing."
        className="gap-2 py-6"
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {receivings.map((receiving) => (
        <ReceivingViewRow key={receiving.id} receiving={receiving} />
      ))}
    </ul>
  )
}

function ReceivingViewRow({ receiving }: { readonly receiving: IRemoteReceiving }) {
  const asset = addableAssetBySymbol(receiving.symbol)
  const symbol = receiving.symbol ?? asset?.token.symbol ?? '—'
  const name = asset?.token.name ?? receiving.symbol ?? 'Unknown asset'
  const failureMessage = receiving.failureMessage?.trim() ?? ''
  const usdLabel = formatStoredUsdAmount(receiving.usdAmount)

  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-6">
      <TokenAvatar
        address={asset?.token.address ?? null}
        symbol={symbol}
        chainId={asset?.chainId ?? null}
        className="size-9"
      />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm">
          <span className="font-medium">{symbol}</span>
          <span className="truncate text-xs text-muted-foreground">Receiving</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">
            {name}
            {asset?.chainName === undefined ? null : ` · ${asset.chainName}`}
          </span>
          <ReceivingTimestamp value={receiving.createdAt} />
        </span>
        {failureMessage === '' ? null : (
          <span className="text-xs break-words text-destructive">{failureMessage}</span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <AmountWithUnit
          amount={receiving.amount === null || receiving.amount === '' ? '—' : receiving.amount}
          unit={symbol === '—' ? '' : symbol}
          className="text-sm font-semibold"
        />
        {usdLabel === null ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">{usdLabel}</span>
        )}
        <SendingStatusBadge status={receiving.status} />
      </span>
    </li>
  )
}

const SKELETON_COUNT = 3

function ReceivingListSkeleton({ compact = false }: { readonly compact?: boolean }) {
  const count = compact ? 2 : SKELETON_COUNT

  return (
    <div className="divide-y divide-border" aria-busy aria-live="polite">
      <span className="sr-only">Loading receivings</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex h-16 items-center gap-3 px-4 sm:px-6" aria-hidden>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  )
}

function ReceivingTimestamp({ value }: { readonly value: string }) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return <time dateTime={value}>{value}</time>
  }

  return (
    <time dateTime={value} className="shrink-0">
      {date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </time>
  )
}
