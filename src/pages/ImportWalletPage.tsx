import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { isAppError } from '@/core'
import {
  PasswordFields,
  SeedPhraseInput,
  isPasswordPairValid,
  useOnboarding,
} from '@/features/onboarding'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui'

/**
 * Импорт существующего кошелька.
 *
 * Фраза и пароль вводятся на одном экране, а не по шагам: пользователь
 * уже владеет фразой, и разбивать ввод на два экрана значит удлинять
 * время, в течение которого секрет находится в поле ввода.
 *
 * Валидация фразы выполняется по мере ввода, но сообщение об ошибке
 * появляется только когда введено достаточно слов: подсветка «некорректно»
 * после первого символа приучает не читать сообщения.
 */
export function ImportWalletPage() {
  const onboarding = useOnboarding()
  const navigate = useNavigate()

  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  /* Валидация выполняется на каждое нажатие клавиши: для 24 слов это
     построение множества и проверка контрольной суммы. Мемоизация
     по строке избавляет от повторного счёта при перерисовках,
     вызванных другими полями. */
  const validation = useMemo(() => onboarding.checkMnemonic(phrase), [onboarding, phrase])

  const canSubmit = validation.isValid && isPasswordPairValid(password, confirmation) && !isBusy

  const handleImport = async () => {
    setError(null)
    setIsBusy(true)

    try {
      await onboarding.importWallet(phrase, password)

      setPhrase('')
      setPassword('')
      setConfirmation('')

      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : 'Не удалось импортировать кошелёк')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link to="/">
              <ArrowLeft />
              Назад
            </Link>
          </Button>

          <CardTitle>Импорт кошелька</CardTitle>
          <CardDescription>
            Введите seed-фразу из 12 или 24 слов и придумайте пароль для этого устройства
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <SeedPhraseInput
            value={phrase}
            validation={validation}
            disabled={isBusy}
            onChange={(value) => {
              setPhrase(value)
              setError(null)
            }}
          />

          {/* Предупреждение, а не отказ: импорт тестовой фразы —
              обычная работа разработчика, и запрещать её было бы
              ошибкой. Но человек, взявший такую фразу из статьи
              или примера, обязан узнать об этом до того, как переведёт
              на её адрес средства. */}
          {validation.isGuessable && (
            <Alert variant="danger">
              <AlertDescription>
                Это общеизвестная тестовая фраза: её приватные ключи вычисляет любой желающий.
                Средства, поступившие на её адреса, выводятся ботами за секунды. Импортируйте её
                только для проверки работы кошелька.
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <AlertDescription>
              Вводите фразу только в этом окне. Ни один сотрудник поддержки и ни один сайт не имеет
              права её запрашивать.
            </AlertDescription>
          </Alert>

          <PasswordFields
            password={password}
            confirmation={confirmation}
            disabled={isBusy}
            onPasswordChange={setPassword}
            onConfirmationChange={setConfirmation}
          />

          {error !== null && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            size="lg"
            disabled={!canSubmit}
            onClick={() => {
              void handleImport()
            }}
          >
            {isBusy ? 'Шифрование…' : 'Импортировать'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
