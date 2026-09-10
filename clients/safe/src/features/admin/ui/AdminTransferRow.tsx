import { Pencil } from 'lucide-react'

import type { RemoteSendingStatus } from '@/features/onboarding'
import { shortenAddress } from '@/features/wallet'
import { AmountWithUnit } from '@/features/wallet/ui/AmountWithUnit'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { Button } from '@/shared/ui'

import { formatAdminListAmount, formatAdminRecordId } from '../lib/admin-transfer-display'
import { formatAdminTimestampParts } from '../lib/format-admin-timestamp'
import { addableAssetBySymbol } from '../model/addable-assets'
import { SendingStatusBadge } from './SendingStatusBadge'

interface AdminTransferRowProps {
  readonly symbol: string | null
  readonly amount: string | null
  readonly userEmail: string
  readonly recordId: string
  readonly status: RemoteSendingStatus | null
  readonly createdAt: string
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly usdLabel?: string | null
  readonly onEdit?: () => void
}

/**
 * One cabinet transfer or deposit.
 *
 * A card, not a stretched table row: who and where fill the left,
 * the amount sits against the right edge, and time / id / status
 * share a footer so the middle is not an empty band.
 */
export function AdminTransferRow({
  symbol: rawSymbol,
  amount,
  userEmail,
  recordId,
  status,
  createdAt,
  failureMessage = null,
  recipientAddress = null,
  usdLabel = null,
  onEdit,
}: AdminTransferRowProps) {
  const asset = addableAssetBySymbol(rawSymbol)
  const symbol = rawSymbol ?? asset?.token.symbol ?? '—'
  const name = asset?.token.name ?? rawSymbol ?? 'Unknown asset'
  const network = asset?.chainName ?? 'Unknown network'
  const storedAmount = amount === null || amount.trim() === '' ? null : amount.trim()
  const displayAmount = formatAdminListAmount(storedAmount)
  const recipient =
    recipientAddress === null || recipientAddress === '' ? null : recipientAddress
  const timestamp = formatAdminTimestampParts(createdAt)
  const reason = failureMessage?.trim() ?? ''

  return (
    <li className="rounded-xl border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <TokenAvatar
          address={asset?.token.address ?? null}
          symbol={symbol}
          chainId={asset?.chainId ?? null}
          className="size-10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{userEmail}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {name} · {network}
              </p>
              {recipient === null ? null : (
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={recipient}>
                  To {shortenAddress(recipient)}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <span
                {...(storedAmount !== null && storedAmount !== displayAmount
                  ? { title: storedAmount }
                  : {})}
              >
                <AmountWithUnit
                  amount={displayAmount}
                  unit={symbol === '—' ? '' : symbol}
                  className="text-2xl font-semibold tracking-tight"
                />
              </span>
              {usdLabel === null ? null : (
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{usdLabel}</p>
              )}
            </div>
          </div>
          {reason === '' ? null : (
            <p className="mt-1.5 text-xs break-words text-destructive">{reason}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              {timestamp === null ? (
                <time dateTime={createdAt}>{createdAt}</time>
              ) : (
                <time dateTime={createdAt} className="tabular-nums">
                  <span className="font-medium text-foreground">{timestamp.time}</span>
                  <span> · {timestamp.date}</span>
                </time>
              )}
              <span aria-hidden>·</span>
              <span title={`id ${recordId}`}>id {formatAdminRecordId(recordId)}</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <SendingStatusBadge status={status} />
              {onEdit === undefined ? null : (
                <Button type="button" variant="outline" size="sm" onClick={onEdit}>
                  <Pencil />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}
