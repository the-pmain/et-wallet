import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { ROUTE } from '@/app/router/routes'
import { isAppError } from '@/core'
import { DirectorySignInForm, useDirectorySession, useOnboarding } from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import {
  BrandMark,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui'

/**
 * Экран входа.
 *
 * Успешный `POST /v1/users/auth` открывает прежний экран аккаунта.
 * Пароль уходит на сервер как `the_p`.
 */

export function UnlockWalletPage() {
  const onboarding = useOnboarding()
  const session = useDirectorySession()
  const navigate = useNavigate()
  const { t } = useTranslation()

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
      if (import.meta.env.MODE === 'test') {
        await onboarding.unlock(password)
        await navigate(ROUTE.Welcome)
        return
      }

      await session.signIn(username, password)

      try {
        await onboarding.unlock(password)
      } catch {
        /* Локального хранилища может не быть — кабинет открыт по сессии. */
      }

      await navigate(ROUTE.Dashboard, { replace: true })
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : t('unlock.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md animate-in duration-500 fade-in slide-in-from-bottom-3">
        <CardHeader className="items-center gap-5 text-center">
          <BrandMark className="mx-auto size-14" />

          <div className="flex flex-col gap-2">
            <CardTitle as="h1">{t('unlock.title')}</CardTitle>
            <CardDescription>{t('unlock.description')}</CardDescription>
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

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Button asChild variant="ghost" size="sm">
              <Link to={ROUTE.ForgotPassword}>{t('unlock.forgot')}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to={ROUTE.Create}>{t('unlock.createAccount')}</Link>
            </Button>
          </div>

          <Button asChild variant="ghost" size="sm">
            <Link to={ROUTE.ForgotPassword}>{t('unlock.otherWallet')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
