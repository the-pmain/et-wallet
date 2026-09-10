import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { useTranslation } from '@/shared/i18n'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import type { IRemoteReceiving, IRemoteSending } from '../model/RemoteUserDirectory'
import { UserReceivingsList } from './UserReceivingsList'
import { UserSendingsList } from './UserSendingsList'

/**
 * Home slice of sendings and receivings.
 *
 * Two labeled lists, not one mixed feed: Activity already splits
 * the archive that way, and home should preview the same groups.
 * Each list is capped so the balance stays above the fold.
 */
export function RecentActivityCard({
  sendings,
  receivings,
  isLoadingSendings,
  isLoadingReceivings,
  sendingsError,
  receivingsError,
}: {
  readonly sendings: readonly IRemoteSending[]
  readonly receivings: readonly IRemoteReceiving[]
  readonly isLoadingSendings: boolean
  readonly isLoadingReceivings: boolean
  readonly sendingsError: string | null
  readonly receivingsError: string | null
}) {
  const { t } = useTranslation()
  const isLoading = isLoadingSendings || isLoadingReceivings

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          {t('dashboard.recent')}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col p-0 sm:p-0" aria-busy={isLoading}>
        <section aria-labelledby="recent-sendings-heading">
          <h3
            id="recent-sendings-heading"
            className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-6"
          >
            Sendings
          </h3>
          <UserSendingsList
            sendings={sendings}
            isLoading={isLoadingSendings}
            error={sendingsError}
            compact
          />
        </section>

        <section aria-labelledby="recent-receivings-heading" className="border-t border-border">
          <h3
            id="recent-receivings-heading"
            className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:px-6"
          >
            Receivings
          </h3>
          <UserReceivingsList
            receivings={receivings}
            isLoading={isLoadingReceivings}
            error={receivingsError}
            compact
          />
        </section>

        <div className="px-4 pt-1 pb-4 sm:px-6">
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
