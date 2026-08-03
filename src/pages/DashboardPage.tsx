import { ArrowRight, ChartPie } from 'lucide-react'
import { Link } from 'react-router'

import {
  BalanceCard,
  QuickActions,
  SESSION_STATE,
  TransferList,
  useWallet,
  useWalletSnapshot,
} from '@/features/wallet'
import { useOnboarding } from '@/features/onboarding'
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

/**
 * Главный экран разблокированного кошелька.
 *
 * ОТВЕЧАЕТ НА ДВА ВОПРОСА: сколько у меня и что происходит. Управление
 * аккаунтами, сетями и узлами перенесено в настройки: это изменения
 * устройства кошелька, и им не место на экране, куда пользователь заходит
 * посмотреть баланс.
 *
 * ОШИБКА ОТКРЫТИЯ СЕССИИ ПОКАЗЫВАЕТСЯ, А НЕ ГЛОТАЕТСЯ. Пустой экран после
 * успешного ввода пароля выглядит как потеря кошелька.
 */
export function DashboardPage() {
  const session = useWallet()
  const onboarding = useOnboarding()
  const snapshot = useWalletSnapshot()
  const { t } = useTranslation()

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
            onboarding.lock()
          }}
        >
          Lock
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <BalanceCard
        balance={snapshot.balance}
        network={snapshot.activeNetwork}
        isLoading={snapshot.isBalanceLoading}
        error={snapshot.balanceError}
        onRefresh={() => void session.refreshBalance()}
        action={
          /* Портфель не попал в нижнюю панель сознательно: пять пунктов —
             предел для окна шириной 360 пикселей, и шестой сделал бы
             подписи нечитаемыми. Вход отсюда и из раздела активов. */
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link to="/wallet/portfolio">
              <ChartPie className="size-4" aria-hidden />
              {t('dashboard.portfolio')}
            </Link>
          </Button>
        }
      />

      <QuickActions
        account={snapshot.activeAccount}
        isBusy={snapshot.isBalanceLoading}
        onRefresh={() => void session.refreshBalance()}
        onLock={() => {
          onboarding.lock()
        }}
      />

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
                No operations were found for the available period. The full list and the limits of
                the source are in the History section.
              </>
            }
          />

          <div className="px-4 pb-4 sm:px-6">
            <Button asChild variant="ghost" size="sm" className="w-full">
              <Link to="/wallet/activity">
                {t('dashboard.allHistory')}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
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
