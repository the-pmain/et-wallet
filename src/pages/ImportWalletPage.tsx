import { ArrowLeft } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { isAppError, isValidUsername } from '@/core'
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
  Input,
  Label,
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

  const usernameId = useId()

  const [phrase, setPhrase] = useState('')
  const [username, setUsername] = useState('')
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
      await onboarding.importWallet(phrase, password, username)

      setPhrase('')
      setPassword('')
      setConfirmation('')

      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : 'The wallet could not be imported')
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
              Back
            </Link>
          </Button>

          <CardTitle>Import a wallet</CardTitle>
          <CardDescription>
            Enter a seed phrase of 12 or 24 words and choose a password for this device
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
                This is a well-known test phrase: anyone can compute its private keys. Funds
                arriving at its addresses are swept by bots within seconds. Import it only to check
                that the wallet works.
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <AlertDescription>
              Enter the phrase in this window only. No support agent and no website has the right to
              ask for it.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <Label htmlFor={usernameId}>Your name</Label>
            <Input
              id={usernameId}
              value={username}
              placeholder="For example, Alex"
              disabled={isBusy}
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              aria-invalid={username !== '' && !isValidUsername(username)}
              onChange={(event) => {
                setUsername(event.target.value)
                setError(null)
              }}
            />
            {/* Имя необязательно: восстановленный кошелёк работает и без
                него, аккаунты тогда называются «Аккаунт 1». Требовать
                его здесь значило бы придумывать препятствие человеку,
                который восстанавливает доступ к своим средствам. */}
            <p className="text-xs text-muted-foreground">
              Optional. The name is stored on this device only and labels the wallet in the
              interface — it is not an account.
            </p>
          </div>

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
            {isBusy ? 'Encrypting…' : 'Import'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
