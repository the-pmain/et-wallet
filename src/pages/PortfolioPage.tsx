import { safeText } from '@/core'
import { UntrustedText } from '@/features/security'
import {
  ArrowLeft,
  ArrowUpRight,
  ChartPie,
  EyeOff,
  Info,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { ChainId, IPortfolioPosition, IPortfolioSummary } from '@/core'
import {
  TokenAvatar,
  TokenTrustBadge,
  formatChangePercent,
  formatShare,
  formatTokenAmount,
  positionKey,
  sliceColor,
  useWallet,
  useWalletSnapshot,
} from '@/features/wallet'
import { useDisplayCurrency } from '@/features/wallet/model/display-currency-context'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DonutChart,
  EmptyState,
  type IDonutSlice,
} from '@/shared/ui'

/**
 * Portfolio: value, allocation, change, and stats.
 *
 * VALUATION REQUIRES CONSENT AND DOES NOT APPEAR ON ITS OWN. A token
 * rate is requested by contract address, so the request tells a
 * third-party service the portfolio composition. The wallet address
 * is not sent — the service does not know whose portfolio it is —
 * but it does learn the holdings, and the owner of the funds decides
 * that.
 *
 * UNKNOWN IS NOT REPLACED WITH ZERO. A position without a rate is
 * left out of the total and stays in the list: it is shown with a
 * dash and counted on a separate stats row. A total that silently
 * omitted half the assets is a wrong total presented as right.
 */
export function PortfolioPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  const [isBusy, setBusy] = useState(false)

  const network = snapshot.activeNetwork
  const portfolio = snapshot.portfolio

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)

    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/wallet">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>

        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Portfolio</h1>

        {snapshot.arePricesEnabled ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy || snapshot.isPortfolioLoading}
            onClick={() => void run(() => session.refreshPrices())}
          >
            <RefreshCw
              className={snapshot.isPortfolioLoading ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden
            />
            Refresh
          </Button>
        ) : null}
      </header>

      {snapshot.arePricesEnabled ? null : (
        <PriceConsent
          sourceName={snapshot.priceSourceName}
          isBusy={isBusy}
          onEnable={() => void run(() => session.enablePrices())}
        />
      )}

      {snapshot.priceError === null ? null : (
        <Alert variant="danger">
          <AlertTitle>Prices could not be fetched</AlertTitle>
          <AlertDescription>
            Only the positions with a known price are shown. That does not mean the rest are
            worthless. The source replied: "{snapshot.priceError}".
          </AlertDescription>
        </Alert>
      )}

      {snapshot.arePricesEnabled && portfolio !== null ? (
        <>
          <PortfolioValue portfolio={portfolio} networkName={network?.name ?? ''} />
          <AllocationCard portfolio={portfolio} />
          <PositionsCard portfolio={portfolio} chainId={network?.chainId ?? null} />
          <StatisticsCard portfolio={portfolio} sourceName={snapshot.priceSourceName} />
        </>
      ) : null}

      {snapshot.arePricesEnabled && portfolio === null ? (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <EmptyState
              icon={ChartPie}
              title={
                snapshot.isPortfolioLoading ? 'Calculating the value…' : 'Valuation unavailable'
              }
              description={
                snapshot.isPortfolioLoading
                  ? 'Fetching asset prices.'
                  : 'This network holds no tracked assets, or their balances have not arrived yet. An empty valuation does not mean the funds are gone.'
              }
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

interface PriceConsentProps {
  readonly sourceName: string
  readonly isBusy: boolean
  readonly onEnable: () => void
}

/**
 * Consent request to talk to the price source.
 *
 * WHAT LEAVES AND WHAT DOES NOT ARE BOTH NAMED. Consent given for a
 * vague "better experience" is not consent: a person cannot decide
 * about what they were not told.
 */
function PriceConsent({ sourceName, isBusy, onEnable }: PriceConsentProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Portfolio value is turned off</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          To show the value, the wallet will contact a third-party price service
          {sourceName === '' ? '' : ` «${sourceName}»`}.
        </p>

        {/*
          THE TWO SIDES OF THE DEAL ARE TWO BLOCKS, NOT ONE LIST.

          "What it learns" and "what it does not" used to sit in one
          stack inside a shared frame: weighing them meant reading
          everything in order and holding both halves in mind.
          Consent is given on the ratio of cost to what stays
          protected, and that ratio must be seen whole, not assembled
          line by line.

          Colors come from the semantic risk scale: yellow is the
          cost, green is what does not leave. Color is not the only
          cue: each side has its own icon and heading, so the meaning
          reads without telling colors apart.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border border-risk-medium/40 bg-risk-medium/5 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <ArrowUpRight className="size-3.5 shrink-0 text-risk-medium" aria-hidden />
              What the service learns
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
              <li>
                the contract addresses of your tokens — that is, the composition of the portfolio;
              </li>
              <li>the network you work in;</li>
              {/* A line about session length lived here while rates
                  were polled every minute. Polling is gone, the call
                  is one-shot again — and the line left with it: the
                  list must describe what happens now, not what used
                  to. An extra warning devalues its neighbors as much
                  as a missing one. */}
              <li>your IP address.</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-risk-low/40 bg-risk-low/5 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-3.5 shrink-0 text-risk-low" aria-hidden />
              What the service does not learn
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
              <li>your wallet address — it is never sent;</li>
              <li>your balances — they never leave the device;</li>
              <li>the seed phrase and the keys — they never leave the device at all.</li>
            </ul>
          </div>
        </div>

        <Button size="lg" disabled={isBusy} onClick={onEnable}>
          <ChartPie className="size-4" aria-hidden />
          Show the value
        </Button>

        <p className="text-xs text-muted-foreground">
          The decision can be reversed at any time: balances and history do not depend on it.
        </p>
      </CardContent>
    </Card>
  )
}

interface PortfolioValueProps {
  readonly portfolio: IPortfolioSummary
  readonly networkName: string
}

function PortfolioValue({ portfolio, networkName }: PortfolioValueProps) {
  const { formatUsd } = useDisplayCurrency()
  const isGrowing = (portfolio.change24hPercent ?? 0) >= 0
  const ChangeIcon = isGrowing ? TrendingUp : TrendingDown

  /* No valued position means the total is unknown, not zero. Showing
     "$0.00" here would tell the owner their assets are worthless,
     when the wallet simply received no rates. */
  const hasValued = portfolio.positions.some((position) => position.value !== null)

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          Value in {networkName === '' ? '—' : networkName}
        </span>

        <span className="text-3xl font-semibold tabular-nums">
          {formatUsd(hasValued ? portfolio.totalValue : null)}
        </span>

        {hasValued ? null : (
          <span className="text-xs text-muted-foreground">
            No price is known for any asset, so the value was not calculated. That does not mean the
            assets are worthless.
          </span>
        )}

        {!hasValued ? null : portfolio.change24hPercent === null ? (
          /* Two different reasons for a missing percent, and they
             cannot share one sentence: "the source did not report a
             change" is a claim about the source, and a zero yesterday
             value is a property of the portfolio. Saying the first
             instead of the second blames the service for something
             it did not do. */
          <span className="text-xs text-muted-foreground">
            {portfolio.previousValue === null
              ? 'The 24-hour change is unknown: the source reported none for any asset.'
              : 'A day ago the portfolio was worth nothing, so the change in percent is undefined.'}
          </span>
        ) : (
          <span
            className="flex items-center gap-1.5 text-sm tabular-nums"
            style={{ color: isGrowing ? 'var(--risk-low)' : 'var(--risk-high)' }}
          >
            <ChangeIcon className="size-4" aria-hidden />
            {formatChangePercent(portfolio.change24hPercent)}
            <span className="text-muted-foreground">
              ({formatUsd(portfolio.change24hValue)} over 24 h)
            </span>
          </span>
        )}

        {/* A distinction without which the number misleads: buying an
            asset in a day raises portfolio value, but that is not a
            price rise, and it must not be credited as income. */}
        <p className="text-xs text-muted-foreground">
          The change is computed from asset prices with an unchanged composition. Purchases, sales
          and transfers made during the day are not part of it.
        </p>
      </CardContent>
    </Card>
  )
}

/** Asset allocation: a ring plus a list with numbers. */
function AllocationCard({ portfolio }: { readonly portfolio: IPortfolioSummary }) {
  const { formatUsd } = useDisplayCurrency()
  const valued = portfolio.positions.filter((position) => position.share !== null)

  if (valued.length === 0) {
    return null
  }

  const slices: IDonutSlice[] = valued.map((position, index) => ({
    id: positionKey(position),
    label: position.token.symbol,
    share: position.share ?? 0,
    color: sliceColor(index),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">Allocation</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-4">
        <DonutChart
          slices={slices}
          caption={String(valued.length)}
          captionHint={valued.length === 1 ? 'asset' : 'assets'}
        />

        {/* The list is required: 18% vs 22% is invisible on the
            ring, and color as the only cue is unavailable to people
            with impaired color vision. */}
        <ul className="flex w-full flex-col gap-2">
          {valued.map((position, index) => (
            <li key={positionKey(position)} className="flex items-center gap-2 text-sm">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: sliceColor(index) }}
                aria-hidden
              />
              <span className="flex-1 truncate font-medium">
                <UntrustedText value={position.token.symbol} />
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatShare(position.share)}
              </span>
              <span className="w-24 text-right tabular-nums">{formatUsd(position.value)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Full position list, including those without a valuation. */
function PositionsCard({
  portfolio,
  chainId,
}: {
  readonly portfolio: IPortfolioSummary
  /* The coin mark is keyed by network plus address: the same
     address on different networks is different contracts. */
  readonly chainId: ChainId | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">Assets</CardTitle>
      </CardHeader>

      <CardContent className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {portfolio.positions.map((position) => (
            <PositionRow key={positionKey(position)} position={position} chainId={chainId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function PositionRow({
  position,
  chainId,
}: {
  readonly position: IPortfolioPosition
  readonly chainId: ChainId | null
}) {
  const { formatUsd } = useDisplayCurrency()
  const { token, balance, quote, value } = position

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <TokenAvatar address={token.address} symbol={token.symbol} chainId={chainId} />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            <UntrustedText value={token.symbol} />
          </span>
          <TokenTrustBadge token={token} />
        </span>

        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {balance === null
            ? 'balance not received'
            : `${formatTokenAmount(balance, token.decimals)} ${safeText(token.symbol)}`}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm tabular-nums">{formatUsd(value)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {quote === null ? 'price unknown' : formatChangePercent(quote.change24hPercent)}
        </span>
      </span>
    </li>
  )
}

interface StatisticsCardProps {
  readonly portfolio: IPortfolioSummary
  readonly sourceName: string
}

/** Portfolio stats and caveats about how complete the valuation is. */
function StatisticsCard({ portfolio, sourceName }: StatisticsCardProps) {
  const { formatUsd } = useDisplayCurrency()
  const valued = portfolio.positions.filter((position) => position.value !== null)
  const largest = valued[0] ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">Statistics</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 text-sm">
        <StatRow label="Assets in total" value={String(portfolio.positions.length)} />
        <StatRow label="Included in the valuation" value={String(valued.length)} />

        {/* Share is unknown when portfolio value is zero: there is
            nothing to divide by. A "largest share — dash" row says
            nothing and occupies space people read. */}
        {largest === null || largest.share === null ? null : (
          <StatRow
            label="Largest share"
            value={`${safeText(largest.token.symbol)} · ${formatShare(largest.share)}`}
          />
        )}

        <StatRow
          label="Yesterday’s valuation"
          value={portfolio.previousValue === null ? '—' : formatUsd(portfolio.previousValue)}
        />

        {portfolio.positionsWithoutPrice === 0 && portfolio.positionsWithoutBalance === 0 ? null : (
          <Alert variant="warning" className="mt-2">
            <EyeOff />
            <AlertDescription>
              Left out of the valuation:{' '}
              {portfolio.positionsWithoutPrice > 0
                ? `${String(portfolio.positionsWithoutPrice)} without a known price`
                : ''}
              {portfolio.positionsWithoutPrice > 0 && portfolio.positionsWithoutBalance > 0
                ? ', '
                : ''}
              {portfolio.positionsWithoutBalance > 0
                ? `${String(portfolio.positionsWithoutBalance)} with no balance received`
                : ''}
              . That does not mean they are worthless.
            </AlertDescription>
          </Alert>
        )}

        <Alert className="mt-2">
          <Info />
          <AlertDescription>
            The valuation comes from a third-party service
            {sourceName === '' ? '' : ` "${sourceName}"`} and is approximate. It never takes part in
            building a transaction: amounts to send are counted in the minimal units of the network.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

function StatRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
