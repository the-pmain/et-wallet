import { Send } from 'lucide-react'

import { addableAssetBySymbol } from '@/features/admin/model/addable-assets'
import { SendingStatusBadge } from '@/features/admin/ui/SendingStatusBadge'
import { shortenAddress } from '@/features/wallet'
import { AmountWithUnit } from '@/features/wallet/ui/AmountWithUnit'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Alert, AlertDescription, EmptyState, Skeleton } from '@/shared/ui'

import type { IRemoteSending } from '../model/RemoteUserDirectory'

/**
 * Directory transfer list. View only: rows are not clickable.
 *
 * Row density matches history and the asset showcase: a large amount
 * under the address blew the card open and did not read as a list
 * entry.
 */
export function UserSendingsList({
  sendings,
  isLoading,
  error,
}: {
  readonly sendings: readonly IRemoteSending[]
  readonly isLoading: boolean
  readonly error: string | null
}) {
  if (error !== null) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (isLoading) {
    return <SendingListSkeleton />
  }

  if (sendings.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="No sendings yet"
        description="Transfers you send from this account appear here. They are only for viewing."
        className="gap-2 py-6"
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {sendings.map((sending) => (
        <SendingViewRow key={sending.id} sending={sending} />
      ))}
    </ul>
  )
}

function SendingViewRow({ sending }: { readonly sending: IRemoteSending }) {
  const asset = addableAssetBySymbol(sending.symbol)
  const symbol = sending.symbol ?? asset?.token.symbol ?? '—'
  const name = asset?.token.name ?? sending.symbol ?? 'Unknown asset'
  const recipient = sending.recipientAddress
  const recipientLabel = recipient === null || recipient === '' ? '—' : shortenAddress(recipient)
  const failureMessage = sending.failureMessage?.trim() ?? ''

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
          <span className="truncate font-mono text-xs text-muted-foreground">{recipientLabel}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">
            {name}
            {asset?.chainName === undefined ? null : ` · ${asset.chainName}`}
          </span>
          <SendingTimestamp value={sending.createdAt} />
        </span>
        {failureMessage === '' ? null : (
          <span className="text-xs break-words text-destructive">{failureMessage}</span>
        )}
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <AmountWithUnit
          amount={sending.amount === null || sending.amount === '' ? '—' : sending.amount}
          unit={symbol === '—' ? '' : symbol}
          className="text-sm font-semibold"
        />
        <SendingStatusBadge status={sending.status} />
      </span>
    </li>
  )
}

const SKELETON_COUNT = 3

function SendingListSkeleton() {
  return (
    <div className="divide-y divide-border" aria-busy aria-live="polite">
      <span className="sr-only">Loading recent activity</span>
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
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

function SendingTimestamp({ value }: { readonly value: string }) {
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
