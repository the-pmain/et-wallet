import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { useTranslation } from '@/shared/i18n'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import type { IRemoteSending } from '../model/RemoteUserDirectory'
import { UserSendingsList } from './UserSendingsList'

/**
 * Витрина переводов кабинета.
 *
 * Стоит между активами и курсами на главной: `GET /v1/users/:id/sendings`,
 * без потока SSE.
 */
export function SendingsCard({
  sendings,
  isLoading,
  error,
}: {
  readonly sendings: readonly IRemoteSending[]
  readonly isLoading: boolean
  readonly error: string | null
}) {
  const { t } = useTranslation()

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base font-medium text-muted-foreground">
          {t('dashboard.recent')}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-col gap-2 p-0 sm:p-0" aria-busy={isLoading}>
        <UserSendingsList sendings={sendings} isLoading={isLoading} error={error} />

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
