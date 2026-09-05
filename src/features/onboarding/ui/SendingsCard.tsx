import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Button, CABINET_SHEET, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import type { IRemoteSending } from '../model/RemoteUserDirectory'
import { UserSendingsList } from './UserSendingsList'

/**
 * Cabinet transfer showcase.
 *
 * Sits between assets and quotes on home: `GET /v1/users/:id/sendings`,
 * no SSE stream.
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
    <Card className={cn('min-w-0 overflow-hidden', CABINET_SHEET)}>
      <CardHeader className="max-lg:border-b max-lg:border-border max-lg:px-1 max-lg:pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground max-lg:text-sm max-lg:font-semibold max-lg:text-foreground">
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
