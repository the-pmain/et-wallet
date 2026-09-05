import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import {
  useDirectorySession,
  useDisplayedAssets,
  useGenerateExchangeWallet,
  useOnboarding,
  useRefreshRemoteAssets,
  useUserSendings,
  SendingsCard,
  type IRemoteUser,
} from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CABINET_SHEET,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui'
import {
  AssetsCard,
  BalanceCard,
  FiatBalanceCard,
  MarketPricesCard,
  parseDisplayAmount,
  QuickActions,
  SESSION_STATE,
  TransferList,
  useWallet,
  useWalletSnapshot,
} from '@/features/wallet'

/**
 * Home screen of an unlocked wallet.
 *
 * THE DIRECTORY CABINET AND THE LOCAL WALLET SHARE THIS SCREEN. After
 * creation the server record appears together with an open device
 * session. Checking the session before the record shows the old ether
 * card — and after sign-in, while the session is still missing, the
 * same amount in dollars. Reverse the order: a record means cabinet,
 * so creation and sign-in look the same.
 *
 * A SESSION-OPEN FAILURE IS SHOWN, NOT SWALLOWED. A blank screen after
 * a successful password looks like the wallet is gone.
 */
export function DashboardPage() {
  useRefreshRemoteAssets()
  const session = useWallet()
  const onboarding = useOnboarding()
  const directory = useDirectorySession()
  const snapshot = useWalletSnapshot()

  if (directory.user !== null || directory.isRestoring) {
    return (
      <RemoteAccountHome
        user={directory.user}
        isRefreshing={directory.isRefreshing || directory.isRestoring}
      />
    )
  }

  if (snapshot.state === SESSION_STATE.Failed) {
    return (
      <div className="flex flex-col gap-4 py-8">
        <Alert variant="danger">
          <AlertTitle>The wallet could not be opened</AlertTitle>
          <AlertDescription>
            {snapshot.error ?? 'The reason is unknown.'} Your funds are not affected: the seed
            phrase remains the only source of keys.
          </AlertDescription>
        </Alert>

        <Button onClick={() => void session.open()}>Try again</Button>

        <Button
          variant="outline"
          onClick={() => {
            directory.signOut()
            onboarding.lock()
          }}
        >
          Lock
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 max-lg:gap-6">
      <BalanceCard
        balance={snapshot.balance}
        network={snapshot.activeNetwork}
        isLoading={snapshot.isBalanceLoading}
        error={snapshot.balanceError}
        onRefresh={() => void session.refreshBalance()}
        /* Dollar estimate comes from the existing snapshot: portfolio
           rates are fetched in the same pass as balances and tokens,
           and only after consent. The market table below is a separate
           public catalog and contains no owner addresses. */
        portfolio={snapshot.portfolio}
        arePricesEnabled={snapshot.arePricesEnabled}
        isPortfolioLoading={snapshot.isPortfolioLoading}
        /* Actions sit inside the balance card, not as a slab under it:
           the amount and what you do with it are one object. Portfolio
           is in the same row — it is the same kind of money action —
           and was left out of the bottom bar on purpose: five items
           is the limit for a 360-pixel window. */
        action={<QuickActions account={snapshot.activeAccount} wallets={{}} />}
      />

      <AssetsCard />

      <RecentActivity />

      <MarketPricesCard />
    </div>
  )
}

/**
 * How many operations the home screen shows.
 *
 * Home is a slice, not an archive: a long list pushes the balance —
 * the reason the screen is opened — out of view.
 */
const RECENT_LIMIT = 5

/** Live-rate valuation of holdings; falls back to the `balance` column. */
function remotePortfolioUsd(
  user: IRemoteUser,
  totalValue: number | null,
  quotesReady: boolean,
): number | null {
  if (user.assets.tokens.length > 0) {
    return quotesReady ? totalValue : null
  }

  return parseDisplayAmount(user.balance)
}

function RemoteAccountHome({
  user,
  isRefreshing,
}: {
  readonly user: IRemoteUser | null
  readonly isRefreshing: boolean
}) {
  const snapshot = useWalletSnapshot()
  const exchangeWallet = useGenerateExchangeWallet()
  const userSendings = useUserSendings(true)
  const displayed = useDisplayedAssets({
    tokens: [],
    portfolio: null,
    isLoading: false,
  })
  const quotesReady = user !== null && !displayed.isLoading
  const amountUsd =
    user === null
      ? null
      : remotePortfolioUsd(user, displayed.portfolio?.totalValue ?? 0, quotesReady)

  return (
    <div className="flex min-w-0 flex-col gap-4 max-lg:gap-6">
      <FiatBalanceCard
        amountUsd={amountUsd}
        isRefreshing={isRefreshing || displayed.isLoading}
        action={
          <QuickActions
            account={snapshot.activeAccount}
            wallets={user?.wallets ?? {}}
            isGeneratingExchangeWallet={exchangeWallet.isGenerating}
            generationError={exchangeWallet.error}
            onGenerateExchangeWallet={() => {
              void exchangeWallet.generate()
            }}
          />
        }
      />

      <AssetsCard />

      <SendingsCard
        sendings={userSendings.sendings.slice(0, RECENT_LIMIT)}
        isLoading={userSendings.isLoading}
        error={userSendings.error}
      />

      <MarketPricesCard />
    </div>
  )
}

function RecentActivity() {
  const snapshot = useWalletSnapshot()
  const { t } = useTranslation()

  return (
    <Card className={CABINET_SHEET}>
      <CardHeader className="max-lg:border-b max-lg:border-border max-lg:px-1 max-lg:pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground max-lg:text-sm max-lg:font-semibold max-lg:text-foreground">
          {t('dashboard.recent')}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 p-0 sm:p-0">
        <TransferList
          transfers={snapshot.transfers.slice(0, RECENT_LIMIT)}
          network={snapshot.activeNetwork}
          isLoading={snapshot.isHistoryLoading}
          emptyDescription={
            <>
              No operations were found for the available period. The full list and the limits of the
              source are in the Activity section.
            </>
          }
          emptyClassName="gap-2 py-6"
        />

        <div className="px-4 pb-4 sm:px-6">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/wallet/activity">
              {t('dashboard.allActivity')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
