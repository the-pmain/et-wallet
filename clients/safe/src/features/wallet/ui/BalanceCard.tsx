import { safeText } from '@/core'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { IBalance, INetworkConfig, IPortfolioSummary } from '@/core'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/shared/ui'

import { formatTokenAmount } from '../lib/format'
import { estimateNativeValue } from '../lib/asset-value'
import { formatQuoteTime } from '../lib/portfolio-display'
import { useDisplayCurrency } from '../model/display-currency-context'
import { BalanceAmountSlot } from './BalanceAmountSlot'
import { CurrencySwitch } from './CurrencySwitch'

interface BalanceCardProps {
  readonly balance: IBalance | null
  readonly network: INetworkConfig | null
  readonly isLoading: boolean
  readonly error: string | null
  readonly onRefresh: () => void

  /**
   * Active-network portfolio summary. Only the native-currency rate is
   * used; the estimate is computed from the displayed balance.
   */
  readonly portfolio?: IPortfolioSummary | null

  /** Owner consented to a third-party price source. */
  readonly arePricesEnabled?: boolean

  /** Price quotes are still loading. */
  readonly isPortfolioLoading?: boolean

  /**
   * Action rendered under the balance.
   *
   * Passed in by the page, not built here: screen paths live in the
   * app layer, which this feature cannot see. A string literal here
   * would drift from the route table on the first rename.
   */
  readonly action?: ReactNode
}

/**
 * Native-currency balance of the active account.
 *
 * Four states are shown distinctly: received, stale, failed, not yet
 * received. Collapsing them to "0" is the most dangerous shortcut in
 * a wallet: a user who sees zero instead of an unavailable balance
 * will think the funds are gone.
 *
 * Tokens are not shown here, and that is stated. An empty token list
 * would read as "there are no tokens".
 */
export function BalanceCard({
  balance,
  network,
  isLoading,
  error,
  onRefresh,
  action,
  portfolio = null,
  arePricesEnabled = false,
  isPortfolioLoading = false,
}: BalanceCardProps) {
  const { t } = useTranslation()
  const { currency, setCurrency } = useDisplayCurrency()
  const symbol = network?.nativeCurrency.symbol ?? ''
  const arrivals = useValueArrivals(balance?.raw ?? null)

  return (
    /* The only raised surface on the screen. A second "hero" card
       would mean there is no hero. */
    <Card
      className={cn(
        'surface-hero gap-4 shadow-raised inset-shadow-hairline',
        'max-lg:relative max-lg:gap-5 max-lg:border-transparent max-lg:bg-transparent max-lg:py-2 max-lg:shadow-none max-lg:[background-image:none]',
      )}
    >
      <CardHeader className="flex-col items-start gap-3 max-lg:items-center max-lg:px-0">
        <CurrencySwitch value={currency} onChange={setCurrency} />

        <div className="flex w-full flex-row items-center justify-between gap-2 max-lg:flex-col max-lg:justify-center">
        {/* Label and network share one row so they do not push the
            amount down with two lines of chrome. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-lg:flex-col max-lg:items-center">
          {/* Home-screen h1. The screen used to start at h2, so a
              listener never heard a page name. A separate "Wallet"
              line would only repeat the nav highlight. The existing
              label takes the role: heading order lands on the amount. */}
          <CardTitle
            as="h1"
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase max-lg:sr-only"
          >
            {t('dashboard.balance')}
          </CardTitle>

          {/* Network is a separate chip, not part of the title.
              "Balance · Ethereum" made the network look like a label
              while it is the variable that decides what the digits
              mean: the same figures on another chain are other money. */}
          {network === null ? null : (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card/60 py-0.5 pr-2 pl-1.5 text-xs font-medium max-lg:border-transparent max-lg:bg-transparent max-lg:p-0 max-lg:text-muted-foreground">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  network.isTestnet ? 'bg-risk-medium' : 'bg-risk-low',
                )}
                aria-hidden
              />
              <span className="truncate">{safeText(network.name)}</span>
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh the balance"
          className="max-lg:absolute max-lg:top-2 max-lg:right-0"
        >
          <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        </Button>
        </div>
      </CardHeader>

      {/* `aria-busy`: while a shown amount refreshes, the only cue is
          the spinning icon. A listener would otherwise treat the
          value as final. */}
      <CardContent
        className="flex flex-col gap-2 max-lg:items-center max-lg:px-0 max-lg:text-center"
        aria-busy={isLoading}
      >
        {/* Tabular figures so neighboring amounts line up. Character
            wrap is the overflow guard: a six-decimal token near the
            uint256 cap is seventy-plus digits and stretched the
            document to 2112px in a 961px window. Truncating is
            forbidden — the shown amount must be the amount — so it
            wraps. Spam tokens with astronomical supplies land on
            foreign addresses constantly. */}
        {balance === null ? (
          <BalanceAmountSlot
            isLoading={isLoading}
            loadingLabel="Reading…"
            className="text-muted-foreground max-lg:justify-center"
          >
            —
          </BalanceAmountSlot>
        ) : (
          /*
            The amount confirms a new value arrived. The arrival
            counter is the React key, so the node remounts only when
            the figure actually changes. First paint is count 0 — no
            motion, or it would stack on the page entrance. Same
            amount on a later snapshot does nothing (the session
            recreates the balance object every refresh). Do not
            interpolate from old to new: that would flash amounts the
            owner never held.
          */
          <p
            key={arrivals}
            className={cn(
              'flex min-h-10 max-w-full flex-wrap items-baseline gap-x-2 text-4xl leading-none font-semibold tracking-tight break-all tabular-nums sm:min-h-12 sm:text-5xl',
              'max-lg:justify-center',
              arrivals > 0 &&
                'animate-in duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] fade-in slide-in-from-bottom-1',
            )}
          >
            {formatTokenAmount(balance.raw, balance.decimals)}
            <span className="text-xl font-medium text-muted-foreground">{symbol}</span>
          </p>
        )}

        {/* Fiat estimate sits right under the amount, before caveats:
            it is the same figure in other words, not a footnote. */}
        <BalanceValue
          balance={balance}
          portfolio={portfolio}
          arePricesEnabled={arePricesEnabled}
          isLoading={isPortfolioLoading}
        />

        {balance !== null && balance.isStale && error === null ? (
          <p className="text-xs text-muted-foreground">
            A cached value, refresh in progress. Do not decide to send based on a stale amount.
          </p>
        ) : null}

        {error !== null ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              The node did not answer. The value shown may be stale — that does not mean the funds
              are gone.
            </span>
          </p>
        ) : null}

        {/* Actions sit against the amount; the native-only caveat comes
            after. A paragraph between the figure and the buttons broke
            the "this much — here is what you can do" pairing. */}
        {action}

        {/* Do not restore "ERC-20 balances are not tracked": tracked
            tokens exist, and a stale warning trains people to skip
            the rest. */}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('dashboard.nativeOnly')}</p>
      </CardContent>
    </Card>
  )
}

interface BalanceValueProps {
  readonly balance: IBalance | null
  readonly portfolio: IPortfolioSummary | null
  readonly arePricesEnabled: boolean
  readonly isLoading: boolean
}

/**
 * Dollar estimate of the shown amount.
 *
 * An ETH figure answers nothing for someone who does not watch the
 * rate. The estimate must not replace the on-chain amount: the coin
 * figure is exact, signed, and independent of a third party. This
 * screen never fetches prices — a quote request reveals contract
 * addresses, chain, and IP. Consent is taken on the portfolio screen;
 * until then this is a link there, not a silent opt-in. Four states
 * stay distinct (ready, loading, failed, opted out); zero is never
 * substituted for the last three.
 */
function BalanceValue({ balance, portfolio, arePricesEnabled, isLoading }: BalanceValueProps) {
  const { t } = useTranslation()
  const { formatUsd } = useDisplayCurrency()

  /* Nothing to value without a balance. The row still reserves
     height so the estimate appearing later does not shove the
     actions down. */
  if (balance === null) {
    return <div className="min-h-7" aria-hidden />
  }

  if (!arePricesEnabled) {
    return (
      <Link
        to="/wallet/portfolio"
        className="focus-ring -mx-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline max-lg:mx-auto"
      >
        {t('dashboard.valueOff')}
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
      </Link>
    )
  }

  const value = estimateNativeValue(balance, portfolio)

  if (value === null) {
    return (
      <div className="min-h-7 text-sm text-muted-foreground">
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-28" />
            <span className="sr-only">{t('dashboard.valueLoading')}</span>
          </>
        ) : (
          t('dashboard.valueUnknown')
        )}
      </div>
    )
  }

  const quotedAt = formatQuoteTime(portfolio?.oldestQuoteAt ?? null)

  return (
    <div className="flex flex-col gap-0.5 max-lg:items-center">
      {/* Tabular figures so the estimate lines up under the amount.
          Long-number wrap is the same overflow guard as the amount
          above. Measured: "approximately $123 456 789 012 345 678
          901 234 567 890.00" overflowed its 238px paragraph by 433px
          because grouping separators are not wrap points. A chain
          with a multi-trillion native supply produces that length.
          `break-words` splits only the word that will not fit. */}
      <p className="text-lg font-medium break-words text-muted-foreground tabular-nums">
        {t('dashboard.approxValue', { value: formatUsd(value) })}
      </p>

      {/* Quote time, not "updated just now". Rates poll once a minute
          while the screen is open, but a source failure leaves the
          previous figure — only the timestamp distinguishes live from
          frozen. No row when the quote instant is unknown: inventing
          it from now would label unknown data as fresh. */}
      {quotedAt === null ? null : (
        <p className="text-xs text-muted-foreground/80 tabular-nums">
          {t('dashboard.rateAsOf', { time: quotedAt })}
        </p>
      )}
    </div>
  )
}

/**
 * How many times a value distinct from the previous one arrived.
 *
 * A key on the amount itself would animate on first paint — every
 * visit, stacked on the page entrance. The counter stays 0 until the
 * figure actually changes. Compare the bigint, not the balance object:
 * the session recreates that object on every refresh.
 */
function useValueArrivals(value: bigint | null): number {
  const previous = useRef<bigint | null>(null)
  const [arrivals, setArrivals] = useState(0)

  useEffect(() => {
    if (previous.current !== null && value !== null && value !== previous.current) {
      setArrivals((count) => count + 1)
    }

    previous.current = value
  }, [value])

  return arrivals
}
