import { useId, useState, type FormEvent } from 'react'

import { MAX_EMAIL_LENGTH, isValidEmail } from '@/core'
import { useTranslation } from '@/shared/i18n'
import { Alert, AlertDescription, Button, Input, Label } from '@/shared/ui'

interface DirectorySignInFormProps {
  readonly error: string | null
  readonly isBusy: boolean
  readonly isDisabled?: boolean
  readonly onSubmit: (username: string, password: string) => void
  readonly onValuesChange?: () => void
}

/**
 * Форма входа по почте и `the_p`.
 *
 * Кнопка недоступна только пока поля пустые. Неверная почта не глотается
 * молча: после нажатия показывается сообщение, и запрос не уходит.
 */
export function DirectorySignInForm({
  error,
  isBusy,
  isDisabled = false,
  onSubmit,
  onValuesChange,
}: DirectorySignInFormProps) {
  const { t } = useTranslation()
  const usernameId = useId()
  const passwordId = useId()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [emailIssue, setEmailIssue] = useState<string | null>(null)

  const hasValues = username.trim() !== '' && password.length > 0
  const canSubmit = hasValues && !isBusy && !isDisabled
  const shownError = emailIssue ?? error

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    if (isBusy || isDisabled) {
      return
    }

    if (!hasValues) {
      return
    }

    if (!isValidEmail(username)) {
      setEmailIssue(t('unlock.emailInvalid'))
      return
    }

    setEmailIssue(null)
    onSubmit(username.trim(), password)
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor={usernameId}>{t('unlock.username')}</Label>
        <Input
          id={usernameId}
          type="text"
          inputMode="email"
          value={username}
          disabled={isBusy || isDisabled}
          autoFocus
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={MAX_EMAIL_LENGTH}
          aria-invalid={shownError !== null}
          onChange={(event) => {
            setUsername(event.target.value)
            setEmailIssue(null)
            onValuesChange?.()
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>{t('unlock.password')}</Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={isBusy || isDisabled}
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={256}
          aria-invalid={shownError !== null}
          onChange={(event) => {
            setPassword(event.target.value)
            onValuesChange?.()
          }}
        />
      </div>

      {shownError === null ? null : (
        <Alert variant="warning">
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={!canSubmit}>
        {t('unlock.submit')}
      </Button>
    </form>
  )
}
