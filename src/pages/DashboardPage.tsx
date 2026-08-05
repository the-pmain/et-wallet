import { ArrowRight } from 'lucide-react'
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
        /* Оценка в долларах собирается из уже имеющегося снимка: курсы
           запрашиваются тем же обходом, что балансы и токены, и только
           при данном согласии. Ни одного лишнего обращения наружу
           главный экран не делает. */
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
                the source are in the Activity section.
              </>
            }
            /* Компактнее, чем на экране истории: там пустота — это
               ответ экрана, а здесь она не должна вытеснять баланс. */
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
