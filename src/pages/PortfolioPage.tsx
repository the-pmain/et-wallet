import { safeText } from '@/core'
import { UntrustedText } from '@/features/security'
import {
  ArrowLeft,
  ChartPie,
  EyeOff,
  Info,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { IPortfolioPosition, IPortfolioSummary } from '@/core'
import {
  TokenAvatar,
  TokenTrustBadge,
  formatChangePercent,
  formatFiat,
  formatShare,
  formatTokenAmount,
  positionKey,
  sliceColor,
  useWallet,
  useWalletSnapshot,
} from '@/features/wallet'
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
 * Портфель: стоимость, распределение, изменение и статистика.
 *
 * ОЦЕНКА ТРЕБУЕТ СОГЛАСИЯ И НЕ ПОЯВЛЯЕТСЯ САМА. Курс токена
 * запрашивается по адресу его контракта, то есть запрос сообщает
 * стороннему сервису состав портфеля. Адрес кошелька при этом
 * не передаётся — сервису неизвестно, чей это портфель, — но состав
 * он узнаёт, и решение об этом принимает владелец средств.
 *
 * НЕИЗВЕСТНОЕ НЕ ПОДМЕНЯЕТСЯ НУЛЁМ. Позиция без курса не входит
 * в стоимость и не исчезает из списка: она показывается с прочерком
 * и учитывается в отдельной строке статистики. Сумма, в которую молча
 * не вошла половина активов, — это неверная сумма, выданная за верную.
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

        <h1 className="flex-1 text-lg font-semibold">Portfolio</h1>

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
          <PositionsCard portfolio={portfolio} />
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
 * Запрос согласия на обращение к источнику курсов.
 *
 * ПЕРЕЧИСЛЕНО ИМЕННО ТО, ЧТО УЙДЁТ НАРУЖУ, И ТО, ЧТО НЕ УЙДЁТ.
 * Согласие, данное на общее «улучшение работы», согласием не является:
 * человек не может принять решение о том, чего ему не назвали.
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

        <div className="flex flex-col gap-2 rounded-xl border p-3 text-xs">
          <p className="font-medium">What the service learns</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>
              the contract addresses of your tokens — that is, the composition of the portfolio;
            </li>
            <li>the network you work in;</li>
            <li>your IP address.</li>
          </ul>

          <p className="mt-1 font-medium">What the service does not learn</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>your wallet address — it is never sent;</li>
            <li>your balances — they never leave the device;</li>
            <li>the seed phrase and the keys — they never leave the device at all.</li>
          </ul>
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

/** Стоимость и её суточное изменение. */
function PortfolioValue({ portfolio, networkName }: PortfolioValueProps) {
  const isGrowing = (portfolio.change24hPercent ?? 0) >= 0
  const ChangeIcon = isGrowing ? TrendingUp : TrendingDown

  /* Ни одной оценённой позиции — значит стоимость неизвестна, а не равна
     нулю. Показать «0,00 $» здесь означало бы сообщить владельцу, что его
     активы ничего не стоят, тогда как кошелёк всего лишь не получил
     ни одного курса. */
  const hasValued = portfolio.positions.some((position) => position.value !== null)

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          Value in {networkName === '' ? '—' : networkName}
        </span>

        <span className="text-3xl font-semibold tabular-nums">
          {formatFiat(hasValued ? portfolio.totalValue : null)}
        </span>

        {hasValued ? null : (
          <span className="text-xs text-muted-foreground">
            No price is known for any asset, so the value was not calculated. That does not mean the
            assets are worthless.
          </span>
        )}

        {!hasValued ? null : portfolio.change24hPercent === null ? (
          /* Две разные причины отсутствия процента, и называть их одним
             текстом нельзя: «источник не сообщил изменение» — утверждение
             об источнике, а нулевая вчерашняя стоимость — свойство самого
             портфеля. Сказать первое вместо второго значит обвинить
             сервис в том, чего он не делал. */
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
              ({formatFiat(portfolio.change24hValue)} over 24 h)
            </span>
          </span>
        )}

        {/* Различение, без которого число вводит в заблуждение: покупка
            актива за сутки увеличивает стоимость портфеля, но это не рост
            курса, и приписывать его пользователю как доход нельзя. */}
        <p className="text-xs text-muted-foreground">
          The change is computed from asset prices with an unchanged composition. Purchases, sales
          and transfers made during the day are not part of it.
        </p>
      </CardContent>
    </Card>
  )
}

/** Распределение активов: кольцо плюс список с числами. */
function AllocationCard({ portfolio }: { readonly portfolio: IPortfolioSummary }) {
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

        {/* Список обязателен: разница между 18 % и 22 % на кольце
            неразличима, а цвет как единственный признак недоступен
            людям с нарушением цветовосприятия. */}
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
              <span className="w-24 text-right tabular-nums">{formatFiat(position.value)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Полный список позиций, включая те, для которых оценки нет. */
function PositionsCard({ portfolio }: { readonly portfolio: IPortfolioSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">Assets</CardTitle>
      </CardHeader>

      <CardContent className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {portfolio.positions.map((position) => (
            <PositionRow key={positionKey(position)} position={position} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Одна строка списка активов. */
function PositionRow({ position }: { readonly position: IPortfolioPosition }) {
  const { token, balance, quote, value } = position

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <TokenAvatar address={token.address} symbol={token.symbol} />

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
        <span className="text-sm tabular-nums">{formatFiat(value)}</span>
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

/** Статистика портфеля и оговорки о полноте оценки. */
function StatisticsCard({ portfolio, sourceName }: StatisticsCardProps) {
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

        {/* Доля неизвестна, когда стоимость портфеля нулевая: делить
            не на что. Строка «наибольшая доля — прочерк» ничего
            не сообщает и занимает место, которое читают. */}
        {largest === null || largest.share === null ? null : (
          <StatRow
            label="Largest share"
            value={`${safeText(largest.token.symbol)} · ${formatShare(largest.share)}`}
          />
        )}

        <StatRow
          label="Yesterday’s valuation"
          value={portfolio.previousValue === null ? '—' : formatFiat(portfolio.previousValue)}
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

/** Строка «название — значение». */
function StatRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
