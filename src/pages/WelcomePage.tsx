import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { ROUTE } from '@/app/router/routes'
import { DirectorySignInForm, useDirectorySession, useOnboarding } from '@/features/onboarding'
import { TEST_MODE } from '@/shared/config'
import { useTranslation } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  BrandMark,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui'

/**
 * Первый экран: вход в систему по `email` и `the_p`,
 * либо создание локального кошелька.
 */
export function WelcomePage() {
  const { t } = useTranslation()
  const session = useDirectorySession()
  const onboarding = useOnboarding()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  if (session.isRestoring) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (session.user !== null) {
    return <Navigate to={ROUTE.Dashboard} replace />
  }

  const handleSubmit = async (username: string, password: string) => {
    setError(null)
    setIsBusy(true)

    try {
      await session.signIn(username, password)

      try {
        await onboarding.unlock(password)
      } catch {
        /* Локального хранилища может не быть — кабинет открыт по сессии. */
      }

      await navigate(ROUTE.Dashboard, { replace: true })
    } catch {
      setError(t('unlock.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-6">
      <Card className="w-full max-w-md animate-in duration-500 fade-in slide-in-from-bottom-3">
        <CardHeader className="items-center gap-5 text-center">
          <BrandMark className="mx-auto size-14" />
          <div className="flex flex-col gap-2">
            <CardTitle as="h1">{t('unlock.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('unlock.description')}</p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <DirectorySignInForm
            error={error}
            isBusy={isBusy}
            onValuesChange={() => {
              setError(null)
            }}
            onSubmit={(username, password) => {
              void handleSubmit(username, password)
            }}
          />

          <Button asChild variant="outline" size="lg">
            <Link to="/create">{t('welcome.create')}</Link>
          </Button>

          {TEST_MODE.hideSeedImport ? null : (
            <Button asChild variant="ghost" size="sm">
              <Link to="/import">{t('welcome.import')}</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Alert className="w-full max-w-md bg-card/70 backdrop-blur-sm">
        <ShieldCheck />
        <AlertDescription>
          {TEST_MODE.hideSeedImport ? t('welcome.noticeTestMode') : t('welcome.notice')}
        </AlertDescription>
      </Alert>

      <Link
        to="/trust"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t('welcome.trust')}
      </Link>
    </div>
  )
}
