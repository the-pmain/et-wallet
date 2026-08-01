import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { isAppError } from '@/core'
import { useOnboarding } from '@/features/onboarding'
import { useTranslation } from '@/shared/i18n'
import {
  Alert,
  AlertDescription,
  BrandMark,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  LanguageSwitch,
} from '@/shared/ui'

/**
 * Экран разблокировки.
 *
 * Сообщение об ошибке намеренно не различает «неверный пароль»,
 * «неверный адрес» и «хранилище повреждено»: отличие этих случаев —
 * информация для подбирающего пароль, а пользователю оно ничего
 * не даёт. Различение выполнено на уровне ядра и в интерфейс
 * не выносится.
 *
 * АДРЕС ПОЧТЫ НЕ ЯВЛЯЕТСЯ ВТОРЫМ ФАКТОРОМ. Он хранится в том же
 * зашифрованном хранилище и сверяется уже после расшифровки, то есть
 * после того, как пароль подошёл. Он помогает не перепутать кошельки
 * и ничего не добавляет к защите от подбора.
 */
export function UnlockWalletPage() {
  const onboarding = useOnboarding()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const emailId = useId()
  const passwordId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      await onboarding.unlock(password, email)
      /* Пароль удаляется из состояния сразу после использования.
         Строку это не затирает — в JavaScript такой возможности нет, —
         но убирает лишнюю ссылку из дерева React. */
      setPassword('')
      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : t('unlock.failed'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <LanguageSwitch className="absolute top-4 right-4" />

      <Card className="w-full max-w-md animate-in duration-500 fade-in slide-in-from-bottom-3">
        <CardHeader className="items-center gap-4 text-center">
          {/* Знак приложения, а не отвлечённый замок: экран ввода пароля —
              главная цель фишинговых копий, и узнаваемость здесь важнее
              иллюстрации действия. */}
          <BrandMark className="mx-auto size-14" />

          <div className="flex flex-col gap-1.5">
            <CardTitle>{t('unlock.title')}</CardTitle>
            <CardDescription>{t('unlock.description')}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void handleSubmit(event)
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={emailId}>{t('unlock.email')}</Label>
              <Input
                id={emailId}
                type="email"
                value={email}
                disabled={isBusy}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                aria-invalid={error !== null}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError(null)
                }}
              />
              {/* Адрес необязателен, и сказать об этом обязательно.
                  Кошелёк, восстановленный по seed-фразе, адреса не имеет
                  вовсе: экран импорта его не собирает. Форма, требующая
                  адрес всегда, не пускала бы владельца в собственный
                  кошелёк — вход был бы невозможен. */}
              <p className="text-xs text-muted-foreground">{t('unlock.emailOptional')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={passwordId}>{t('unlock.password')}</Label>
              <Input
                id={passwordId}
                type="password"
                value={password}
                disabled={isBusy}
                /* Фокус на пароле, а не на адресе: пароль обязателен,
                   адрес — нет. */
                autoFocus
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                aria-invalid={error !== null}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
              />
            </div>

            {error !== null && (
              <Alert variant="warning">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" disabled={isBusy || password.length === 0}>
              {isBusy ? t('unlock.decrypting') : t('unlock.submit')}
            </Button>

            <Button asChild variant="ghost" size="sm">
              <Link to="/forgot-password">{t('unlock.forgot')}</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
