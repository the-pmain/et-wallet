import { ArrowRight, LayoutGrid } from 'lucide-react'
import { Link } from 'react-router'

import { useDisplayedAssets } from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/shared/ui'

import { useWalletSnapshot } from '../model/wallet-context'
import { TokenList } from './TokenList'

/**
 * Витрина активов на главном экране.
 *
 * ТЕ ЖЕ ДАННЫЕ, ЧТО НА ЭКРАНЕ АКТИВОВ. Карточка не ходит за отдельным
 * списком: после входа витрина лежит в записи пользователя, без записи —
 * в снимке сессии. Два разных источника на соседних экранах показали бы
 * разные деньги.
 *
 * УДАЛЕНИЯ ЗДЕСЬ НЕТ. Это обзор, а не управление списком: править
 * отслеживаемые контракты можно на экране активов.
 *
 * СТОИТ ТАМ ЖЕ, ГДЕ ТАБЛИЦА КУРСОВ: отдельной карточкой под балансом.
 * Курсы — публичный каталог без адресов владельца; эта карточка —
 * его токены.
 */
export function AssetsCard() {
  const snapshot = useWalletSnapshot()
  const displayed = useDisplayedAssets({
    tokens: snapshot.tokenBalances,
    portfolio: snapshot.portfolio,
    isLoading: snapshot.isTokensLoading,
  })
  const { t } = useTranslation()

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          {t('dashboard.assets')}
        </CardTitle>
      </CardHeader>

      <CardContent
        className="flex min-w-0 flex-col gap-2 p-0 sm:p-0"
        aria-busy={displayed.isLoading}
      >
        {displayed.tokens.length === 0 && !displayed.isLoading ? (
          <EmptyState
            icon={LayoutGrid}
            title={t('dashboard.assetsEmptyTitle')}
            description={t('dashboard.assetsEmpty')}
            className="gap-2 py-6"
          />
        ) : (
          <TokenList
            tokens={displayed.tokens}
            isLoading={displayed.isLoading}
            portfolio={displayed.portfolio}
          />
        )}

        <div className="px-4 pb-4 sm:px-6">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/wallet/assets">
              {t('dashboard.allAssets')}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
