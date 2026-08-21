import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { useDirectorySession, useOnboarding, type IRemoteUser } from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
 * Главный экран разблокированного кошелька.
 *
 * КАБИНЕТ СПРАВОЧНИКА И ЛОКАЛЬНЫЙ КОШЕЛЁК ДЕЛЯТ ОДИН ЭКРАН. После
 * создания запись на сервере появляется вместе с открытой сессией
 * на устройстве. Если смотреть на сессию раньше записи, владелец
 * видит старую карточку с эфиром — а после входа, когда сессии ещё
 * нет, ту же сумму в долларах. Порядок обратный: есть запись —
 * кабинет, и создание с входом совпадают.
 *
 * ОШИБКА ОТКРЫТИЯ СЕССИИ ПОКАЗЫВАЕТСЯ, А НЕ ГЛОТАЕТСЯ. Пустой экран после
 * успешного ввода пароля выглядит как потеря кошелька.
 */
export function DashboardPage() {
  const session = useWallet()
  const onboarding = useOnboarding()
  const directory = useDirectorySession()
  const snapshot = useWalletSnapshot()

  if (directory.user !== null) {
    return <RemoteAccountHome user={directory.user} isRefreshing={directory.isRefreshing} />
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
    <div className="flex min-w-0 flex-col gap-4">
      <BalanceCard
        balance={snapshot.balance}
        network={snapshot.activeNetwork}
        isLoading={snapshot.isBalanceLoading}
        error={snapshot.balanceError}
        onRefresh={() => void session.refreshBalance()}
        /* Оценка в долларах собирается из уже имеющегося снимка: курсы
           портфеля запрашиваются тем же обходом, что балансы и токены,
           и только при данном согласии. Таблица рынка ниже — отдельный
           публичный каталог: адресов владельца в нём нет. */
        portfolio={snapshot.portfolio}
        arePricesEnabled={snapshot.arePricesEnabled}
        isPortfolioLoading={snapshot.isPortfolioLoading}
        /* Действия встроены в карточку баланса, а не стоят отдельной
           плитой под ней: сумма и обращение с ней — один объект.
           Портфель входит в тот же ряд — он такое же обращение к
           деньгам, а в нижнюю панель не попал сознательно: пять
           пунктов предел для окна шириной 360 пикселей. */
        action={<QuickActions account={snapshot.activeAccount} />}
      />

      <AssetsCard />

      <MarketPricesCard />

      <RecentActivity />
    </div>
  )
}

/**
 * Сколько операций показывается на главном экране.
 *
 * Главный экран даёт срез, а не архив: длинный список вытесняет баланс
 * за пределы видимой области, ради которого экран и открывают.
 */
const RECENT_LIMIT = 5

/** Оценка из витрины `assets`, иначе колонка `balance`. */
function remotePortfolioUsd(user: IRemoteUser): string {
  if (user.assets.tokens.length > 0) {
    return user.assets.totalValueUsd
  }

  return user.balance ?? '0'
}

function RemoteAccountHome({
  user,
  isRefreshing,
}: {
  readonly user: IRemoteUser
  readonly isRefreshing: boolean
}) {
  const snapshot = useWalletSnapshot()

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FiatBalanceCard
        amountUsd={parseDisplayAmount(remotePortfolioUsd(user))}
        isRefreshing={isRefreshing}
        action={<QuickActions account={snapshot.activeAccount} />}
      />

      <AssetsCard />

      <MarketPricesCard />

      <RecentActivity />
    </div>
  )
}

function RecentActivity() {
  const snapshot = useWalletSnapshot()
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
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
