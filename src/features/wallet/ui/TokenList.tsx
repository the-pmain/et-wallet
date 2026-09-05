import { ChevronDown, RefreshCw, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

import { safeText, type Address, type ChainId, type IPortfolioSummary } from '@/core'
import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'
import { Button, Skeleton } from '@/shared/ui'

import { estimateValue, findQuote } from '../lib/asset-value'
import { formatTokenAmount, shortenAddress } from '../lib/format'
import { networkNameForChainId } from '../lib/network-name'
import { useDisplayCurrency } from '../model/display-currency-context'
import type { ITokenBalance } from '../model/contracts'
import { AmountWithUnit } from './AmountWithUnit'
import { TokenAvatar } from './TokenAvatar'
import { TokenDetails } from './TokenDetails'
import { TokenTrustBadge } from './TokenTrustBadge'

/** Placeholder rows while the list is still empty. */
export const TOKEN_LIST_SKELETON_COUNT = 3

interface TokenListProps {
  readonly tokens: readonly ITokenBalance[]
  readonly isLoading: boolean

  /**
   * Remove an added contract. No handler means no button: the
   * user-record showcase is not edited from this screen.
   */
  readonly onRemove?: (address: Address) => void

  /**
   * Portfolio summary. Only quotes are taken; the estimate is computed
   * from the displayed quantity.
   *
   * `null` means quotes are unknown or consent is missing. The value
   * column then does not appear at all; zeros are never used for unknown.
   */
  readonly portfolio?: IPortfolioSummary | null
}

/**
 * Token list with balances.
 *
 * An unread balance is never shown as zero. The contract may have
 * stopped answering; a zero would claim "no funds", which the wallet
 * cannot verify at that moment.
 *
 * Manually added tokens are marked. Anyone can mint a token with a
 * known project's ticker. The mark does not block use, but it keeps
 * a fake from looking like the network native whose config is verified.
 *
 * The row expands in place. A popover would hide neighboring balances,
 * and a nested `listitem` would break the position count. Remove is a
 * sibling button, not a child of the expander: nested buttons are
 * forbidden.
 */
export function TokenList({ tokens, isLoading, onRemove, portfolio = null }: TokenListProps) {
  /* `aria-busy` for the same reason as the balance card: while the
     quantity is loading the only cue is a spinner. */
  return (
    <ul className="divide-y divide-border" aria-busy={isLoading}>
      {isLoading && tokens.length === 0 ? <TokenListSkeleton /> : null}

      {tokens.map((entry) => (
        <TokenRow
          key={`${entry.token.chainId.toString()}:${entry.token.address ?? 'native'}`}
          entry={entry}
          isLoading={isLoading}
          portfolio={portfolio}
          {...(onRemove === undefined ? {} : { onRemove })}
        />
      ))}
    </ul>
  )
}

interface TokenRowProps {
  readonly entry: ITokenBalance
  readonly isLoading: boolean
  readonly portfolio: IPortfolioSummary | null
  readonly onRemove?: (address: Address) => void
}

function TokenRow({ entry, isLoading, portfolio, onRemove }: TokenRowProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const networkName = networkNameForChainId(entry.token.chainId)
  const symbol = safeText(entry.token.symbol)
  const canRemove = onRemove !== undefined && entry.token.address !== null

  return (
    <li className="flex flex-col">
      <div className="relative">
        <button
          type="button"
          className="focus-ring flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/60 sm:px-6"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${symbol} on ${networkName} — asset details`}
          onClick={() => {
            setExpanded((current) => !current)
          }}
        >
          <TokenAvatar
            address={entry.token.address}
            symbol={entry.token.symbol}
            chainId={entry.token.chainId}
          />

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Symbol and name come from the contract author: they can
                carry invisible characters and bidi overrides that make
                a fake visually identical to the original. */}
            <span className="flex items-center gap-1.5 truncate text-sm font-medium">
              <UntrustedText value={entry.token.symbol} />
              <TokenTrustBadge token={entry.token} />
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <UntrustedText value={entry.token.name} />
              {entry.token.address === null ? null : ` · ${shortenAddress(entry.token.address)}`}
            </span>
          </span>

          <span className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-col items-end gap-0.5">
              {/* Quantity outweighs the name. Tabular figures, right
                  aligned. `min-w-0` plus character wrap: a spam-token
                  balance stretched the row to 1738px in 734px. The
                  amount must not be truncated, so it wraps. */}
              <span className="min-w-0 text-right text-base font-semibold break-all tabular-nums">
                {entry.balance === null ? (
                  isLoading ? (
                    <RefreshCw className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )
                ) : (
                  <AmountWithUnit
                    amount={formatTokenAmount(entry.balance, entry.token.decimals)}
                    unit={entry.token.symbol}
                    className="font-semibold"
                  />
                )}
              </span>

              {/* Estimate under the quantity, not instead of it. The
                  coin figure is exact and signed; the dollar line is
                  derivative and smaller for that reason. No row when
                  the rate is unknown (unlisted token, no consent, or
                  unread balance) — a dash column would add noise
                  without information. */}
              <AssetValue
                balance={entry.balance}
                decimals={entry.token.decimals}
                chainId={entry.token.chainId}
                address={entry.token.address}
                portfolio={portfolio}
                isLoading={isLoading}
              />
            </span>

            {/* Spacer only when remove is real. An empty square next
                to the chevron intercepted clicks and made the row
                feel dead; the catalog showcase has no remove at all. */}
            {canRemove ? <span className="size-8 shrink-0" aria-hidden /> : null}

            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </button>

        {canRemove ? (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-10 size-8 -translate-y-1/2 text-muted-foreground hover:text-destructive sm:right-12"
            aria-label={`Remove token ${symbol}`}
            onClick={() => {
              onRemove(entry.token.address as Address)
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <TokenDetails detailsId={detailsId} token={entry.token} portfolio={portfolio} />
      ) : null}
    </li>
  )
}

interface AssetValueProps {
  readonly balance: bigint | null
  readonly decimals: number
  readonly chainId: ChainId | null
  readonly address: Address | null
  readonly portfolio: IPortfolioSummary | null
  readonly isLoading: boolean
}

/** Estimate for one list row. The slot is always reserved. */
function AssetValue({
  balance,
  decimals,
  chainId,
  address,
  portfolio,
  isLoading,
}: AssetValueProps) {
  const { formatUsd } = useDisplayCurrency()
  const value = estimateValue(balance, decimals, findQuote(portfolio, chainId, address))

  return (
    <span className="flex h-3 min-h-3 items-center justify-end">
      {value === null && isLoading ? <Skeleton className="h-3 w-14" /> : null}
      {value === null ? null : (
        <span className="text-right text-xs break-words text-muted-foreground tabular-nums">
          ≈ {formatUsd(value)}
        </span>
      )}
    </span>
  )
}

function TokenListSkeleton() {
  return (
    <>
      {Array.from({ length: TOKEN_LIST_SKELETON_COUNT }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-6" aria-hidden>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-28" />
          </span>
          <span className="flex min-w-0 flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </span>
          <span className="size-8 shrink-0" />
        </li>
      ))}
    </>
  )
}
