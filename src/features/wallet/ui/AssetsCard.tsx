import { ArrowRight, LayoutGrid } from 'lucide-react'
import { Link } from 'react-router'

import { useDisplayedAssets } from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, CABINET_SHEET, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/shared/ui'

import { useWalletSnapshot } from '../model/wallet-context'
import { TokenList } from './TokenList'

/**
 * Asset showcase on the home screen.
 *
 * Same data as the assets screen. After login the showcase lives in the
 * user record; without a record it uses the session snapshot. Two
 * sources on neighboring screens would show different money.
 *
 * No deletion here — this is an overview. Tracked contracts are edited
 * on the assets screen.
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
    <Card className={cn('min-w-0 overflow-hidden', CABINET_SHEET)}>
      <CardHeader className="max-lg:border-b max-lg:border-border max-lg:px-1 max-lg:pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground max-lg:text-sm max-lg:font-semibold max-lg:text-foreground">
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
          <Button asChild variant="ghost" size="sm" className="w-full max-lg:font-semibold max-lg:text-primary-emphasis">
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
