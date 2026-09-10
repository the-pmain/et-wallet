import { Inbox } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'

import type { INetworkConfig, ITransferRecord, TxHash } from '@/core'
import { EmptyState, Skeleton, VirtualList } from '@/shared/ui'

import type { ReplacementKind } from '../lib/replacement'
import { TransferRow } from './TransferRow'

/**
 * Row height in pixels. Must match `h-16` in `TransferRow`.
 *
 * Duplicating the value between markup and code is unavoidable:
 * virtualization places the window by arithmetic and cannot measure
 * each row — that is why it exists. A mismatch does not lose data
 * but shifts the list while scrolling.
 */
const ROW_HEIGHT = 64

interface TransferListProps {
  readonly transfers: readonly ITransferRecord[]
  readonly network: INetworkConfig | null
  readonly isLoading: boolean

  /**
   * Empty-state title.
   *
   * Passed in because there are two reasons for an empty list and
   * they mean different things: no operations, or nothing matched
   * the filter. The first in place of the second reads as funds gone.
   */
  readonly emptyTitle?: string

  readonly emptyDescription: ReactNode

  /**
   * Empty-state styling.
   *
   * Needed because the same list sits on two screens with different
   * costs of emptiness. On history, empty is the point of the screen
   * and gets space. On home, the same block would push the balance —
   * the reason the screen is open — off the bottom.
   */
  readonly emptyClassName?: string | undefined

  /**
   * Starts replacing a stuck send.
   *
   * The reference must be stable: changing it re-renders the whole
   * virtual-list window and voids row memoization.
   */
  readonly onReplace?: ((hash: TxHash, kind: ReplacementKind) => void) | undefined
}

/**
 * Transfer list.
 *
 * Direction is told by a sign and an icon, not color alone. Color as
 * the only cue is invisible to people with color-vision deficiency,
 * and mixing income with expense in a wallet is an expensive mistake.
 *
 * The record source is shown. An unconfirmed send and a confirmed
 * indexer transfer have different reliability, and the user may tell
 * them apart.
 *
 * A long list is virtualized. The threshold is in `VirtualList`: a
 * short list stays ordinary so browser find and print still work.
 * For a long list the history-screen filter makes up for that loss.
 */
export function TransferList({
  transfers,
  network,
  isLoading,
  emptyTitle = 'No operations yet',
  emptyDescription,
  emptyClassName,
  onReplace,
}: TransferListProps) {
  /* Handlers are remade when the network changes, not on every
     render: a new `renderItem` reference would make `VirtualList`
     redraw the whole window and void row memoization. */
  const renderItem = useCallback(
    (record: ITransferRecord) => (
      <TransferRow record={record} network={network} onReplace={onReplace} />
    ),
    [network, onReplace],
  )

  const getKey = useCallback((record: ITransferRecord) => record.id, [])

  if (isLoading && transfers.length === 0) {
    return (
      <div className="divide-y divide-border" aria-busy>
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex h-16 items-center gap-3 px-4 sm:px-6"
            style={{ height: ROW_HEIGHT }}
            aria-hidden
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    )
  }

  if (transfers.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
        className={emptyClassName}
      />
    )
  }

  return (
    <VirtualList
      items={transfers}
      itemHeight={ROW_HEIGHT}
      renderItem={renderItem}
      getKey={getKey}
      className="divide-y divide-border"
    />
  )
}
