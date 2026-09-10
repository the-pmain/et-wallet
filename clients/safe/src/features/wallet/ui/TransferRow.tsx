import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react'
import { memo } from 'react'

import {
  TRANSACTION_STATUS,
  TRANSFER_DIRECTION,
  TRANSFER_SOURCE,
  type INetworkConfig,
  type ITransferRecord,
  type TxHash,
} from '@/core'
import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui'

import { formatTimestamp, shortenAddress } from '../lib/format'
import { REPLACEMENT_KIND, isReplaceable, type ReplacementKind } from '../lib/replacement'
import { describeAmount, describeKind } from '../lib/transfer-display'

interface TransferRowProps {
  readonly record: ITransferRecord
  readonly network: INetworkConfig | null

  /**
   * Starts replacing a stuck outgoing transfer.
   *
   * Optional: the row is also used where there is nothing to replace,
   * for example in a list of someone else's transfers.
   */
  readonly onReplace?: ((hash: TxHash, kind: ReplacementKind) => void) | undefined
}

/**
 * Transfer list row.
 *
 * Extracted for memoization. A transfer record is immutable and comes
 * from a session snapshot that is replaced as a whole: when balance or
 * rate updates, pointers to unchanged records stay, so reference
 * equality skips re-rendering those rows (amount parse and timestamp
 * format included). Default compare is enough: both props live in the
 * snapshot and the session will not swap them for value-equal copies.
 *
 * Row height is fixed. Virtualization places the window by multiplying
 * row height; variable content would shift the list while scrolling.
 * Hence `h-16` and truncation instead of wrap.
 */
export const TransferRow = memo(function TransferRow({
  record,
  network,
  onReplace,
}: TransferRowProps) {
  const isOutgoing = record.direction === TRANSFER_DIRECTION.Outgoing
  const amount = describeAmount(record, network)
  const counterparty = isOutgoing ? record.to : record.from
  const explorer = network?.blockExplorerUrls[0] ?? null
  const canReplace = onReplace !== undefined && isReplaceable(record)

  return (
    <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          isOutgoing ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary-emphasis',
        )}
      >
        {isOutgoing ? (
          <ArrowUpRight className="size-4" aria-hidden />
        ) : (
          <ArrowDownLeft className="size-4" aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm">
          <span className="font-medium">{describeKind(record.kind)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {counterparty === null ? '—' : shortenAddress(counterparty)}
          </span>
        </span>

        <span className="flex flex-nowrap items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          {record.timestamp === null
            ? `Block ${record.blockNumber.toString()}`
            : formatTimestamp(record.timestamp)}

          <StatusBadge record={record} />

          {amount.isRaw ? (
            /* Contract decimals are unknown, so raw units are shown.
               Without the badge the user would read them as a normal
               amount and be off by orders of magnitude. */
            <Badge variant="outline">contract units</Badge>
          ) : null}
        </span>
      </span>

      {/* An unbounded integer must not blow the fixed-height row.
          Wrap is not an option here (virtualization). The column
          shrinks and the figure ellipsizes — the cut is visible, so
          the start cannot be read as the whole amount. */}
      <span className="flex min-w-0 flex-col items-end gap-0.5">
        {/* Full figure goes in `title`. The ticker does not: the
            contract author sets it, and the attribute bypasses the
            sanitizing that `UntrustedText` does. */}
        <span className="max-w-full truncate text-sm font-medium tabular-nums" title={amount.text}>
          {isOutgoing ? '−' : '+'}
          {amount.text} <UntrustedText value={amount.unit} />
        </span>

        {/* On a stuck send, replace actions beat the explorer link:
            the explorer only shows the same wait. Other rows invert
            that priority. */}
        {canReplace ? (
          <span className="flex items-center gap-2">
            <RowAction
              label="Speed up"
              hint="Repeat the same operation with a higher fee"
              onClick={() => onReplace(record.hash, REPLACEMENT_KIND.SpeedUp)}
            />
            <RowAction
              label="Cancel"
              hint="Take the transaction nonce with a transfer to yourself"
              onClick={() => onReplace(record.hash, REPLACEMENT_KIND.Cancel)}
            />
          </span>
        ) : explorer === null ? null : (
          <a
            href={`${explorer}/tx/${record.hash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Explorer
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
})

/**
 * Action inside a list row.
 *
 * A real button, not a link: replace mutates wallet state, goes
 * nowhere, and must answer Space the same as Enter. The hint lives in
 * `title` because a fixed-height row has no room, and Speed up vs
 * Cancel are not synonyms.
 */
function RowAction({
  label,
  hint,
  onClick,
}: {
  readonly label: string
  readonly hint: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className="focus-ring rounded text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline"
    >
      {label}
    </button>
  )
}

/**
 * Transfer status mark.
 *
 * States stay distinct because they mean different things. Own sends
 * used to share one "awaiting confirmation" forever — nothing watched
 * them. Revert is separate and error-colored: the tx landed, gas was
 * spent, the operation did not run; treating it as success reports a
 * transfer that never happened. Confirmed rows get no badge so only
 * what needs attention stands out.
 */
function StatusBadge({ record }: { readonly record: ITransferRecord }) {
  if (record.status === TRANSACTION_STATUS.Pending) {
    return (
      <Badge variant="warning">
        {record.source === TRANSFER_SOURCE.Local
          ? 'Sent, waiting for a block'
          : 'Waiting for a block'}
      </Badge>
    )
  }

  if (record.status === TRANSACTION_STATUS.Reverted) {
    return <Badge variant="danger">Reverted, gas spent</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Replaced) {
    return <Badge variant="outline">Replaced by another transaction</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Dropped) {
    return <Badge variant="outline">Dropped from the queue</Badge>
  }

  return null
}
