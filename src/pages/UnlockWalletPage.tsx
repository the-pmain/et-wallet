import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { FREE_UNLOCK_ATTEMPTS, isAppError } from '@/core'
import { useOnboarding } from '@/features/onboarding'
import { MockUsersLogin } from '@/features/onboarding/ui/MockUsersLogin'
import { useSecurity } from '@/features/security'
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
 *
 * ЗАДЕРЖКА ПОСЛЕ НЕУДАЧ ПОКАЗЫВАЕТСЯ ОТСЧЁТОМ. Форма, молча
 * переставшая принимать пароль, оставляет владельца в недоумении,
 * почему верный пароль не подходит, — и толкает его искать
 * несуществующую поломку. Подбирающему отсчёт не помогает: он и так
 * упирается в ожидание.
 */
/**
 * Оставшееся время в виде «мм:сс».
 *
 * Секунды округляются вверх: показать «0 с» там, где ввод ещё закрыт,
 * значит предложить нажать кнопку, которая не сработает.
 */
function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

export function UnlockWalletPage() {
  const onboarding = useOnboarding()
  const { clock } = useSecurity()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const passwordId = useId()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [throttle, setThrottle] = useState({ failedAttempts: 0, retryAfterMs: 0 })

  const isBlocked = throttle.retryAfterMs > 0

  const refreshThrottle = useCallback(async () => {
    setThrottle(await onboarding.getUnlockThrottleState())
  }, [onboarding])

  /*
    Состояние ограничителя читается при открытии экрана: задержка
    переживает перезагрузку, и показать её надо сразу, а не после первой
    неудачной попытки.

    Значение выставляется в обработчике ответа хранилища, а не в теле
    эффекта: хранилище здесь — внешняя система, и подписка на её ответ
    как раз то, ради чего эффект и существует. Отмена нужна на случай
    ухода с экрана: разблокировка происходит быстрее, чем чтение
    из IndexedDB, и запись состояния после размонтирования была бы
    работой впустую.
  */
  useEffect(() => {
    let isCurrent = true

    void onboarding.getUnlockThrottleState().then((state) => {
      if (isCurrent) {
        setThrottle(state)
      }
    })

    return () => {
      isCurrent = false
    }
  }, [onboarding])

  /*
    Обратный отсчёт.

    Тикает раз в секунду и только пока ввод закрыт: постоянный таймер
    на открытом экране будил бы отрисовку без всякой причины.

    КАЖДЫЙ ТИК ПЕРЕЧИТЫВАЕТ СОСТОЯНИЕ, А НЕ ВЫЧИТАЕТ СЕКУНДУ САМ.
    Срок хранится у ограничителя, и решать, открыт ли ввод, обязан он.
    Собственный счётчик в интерфейсе был бы вторым источником истины
    и разошёлся бы с первым при любой задержке отрисовки — например,
    когда вкладка ушла в фон и браузер притормозил её таймеры.

    ЧАСЫ БЕРУТСЯ ИЗ КОНТЕКСТА, А НЕ ИЗ `globalThis`. Ограничитель
    считает срок по внедрённым часам; системный таймер рядом с ними —
    второй источник времени, и он расходится с первым.
  */
  useEffect(() => {
    if (!isBlocked) {
      return
    }

    return clock.setInterval(() => {
      void refreshThrottle()
    }, 1000)
  }, [clock, isBlocked, refreshThrottle])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      await onboarding.unlock(password)
      setThrottle({ failedAttempts: 0, retryAfterMs: 0 })
      /* Пароль удаляется из состояния сразу после использования.
         Строку это не затирает — в JavaScript такой возможности нет, —
         но убирает лишнюю ссылку из дерева React. */
      setPassword('')
      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : t('unlock.failed'))
      await refreshThrottle()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Card className="w-full animate-in duration-500 fade-in slide-in-from-bottom-3">
          <CardHeader className="items-center gap-4 text-center">
            {/* Знак приложения, а не отвлечённый замок: экран ввода пароля —
              главная цель фишинговых копий, и узнаваемость здесь важнее
              иллюстрации действия. */}
            <BrandMark className="mx-auto size-14" />

            <div className="flex flex-col gap-1.5">
              <CardTitle>{t('unlock.title')} 3</CardTitle>
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
                <Label htmlFor={passwordId}>{t('unlock.password')}</Label>
                <Input
                  id={passwordId}
                  type="password"
                  value={password}
                  disabled={isBusy || isBlocked}
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

              {error !== null && !isBlocked && (
                <Alert variant="warning">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {isBlocked && (
                <Alert variant="danger">
                  <AlertDescription>
                    {t('unlock.blocked')}{' '}
                    <span className="font-medium tabular-nums">
                      {formatCountdown(throttle.retryAfterMs)}
                    </span>
                    . {t('unlock.blockedNote')}
                  </AlertDescription>
                </Alert>
              )}

              {!isBlocked && throttle.failedAttempts > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('unlock.attemptsLeft')}{' '}
                  {String(Math.max(0, FREE_UNLOCK_ATTEMPTS - throttle.failedAttempts))}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={isBusy || isBlocked || password.length === 0}
              >
                {isBusy ? t('unlock.decrypting') : t('unlock.submit')}
              </Button>

              <Button asChild variant="ghost" size="sm">
                <Link to="/forgot-password">{t('unlock.forgot')}</Link>
              </Button>

              {/* ВТОРОЙ ПУТЬ НАЗЫВАЕТСЯ СВОИМ ИМЕНЕМ. Человек, который
                пароль помнит, но хочет завести другой кошелёк либо
                восстановить чужую seed-фразу, за ссылку «забыли пароль»
                не нажмёт — и решит, что кошелёк его никуда не пускает.
                Ведёт туда же: другой кошелёк на устройстве возможен
                только вместо нынешнего, и предупредить об этом обязан
                тот же экран. */}
              <Button asChild variant="ghost" size="sm">
                <Link to="/forgot-password">{t('unlock.otherWallet')}</Link>
              </Button>
            </form>
          </CardContent>
        </Card>

        <MockUsersLogin />
      </div>
    </div>
  )
}
