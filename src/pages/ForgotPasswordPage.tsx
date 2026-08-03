import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { isAppError } from '@/core'
import { useOnboarding } from '@/features/onboarding'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from '@/shared/ui'

/** Слово, которое пользователь обязан ввести для подтверждения. */
const CONFIRMATION_WORD = 'ERASE'

/**
 * Экран «Забыли пароль».
 *
 * НАЗВАНИЕ ВВОДИТ В ЗАБЛУЖДЕНИЕ, и первое, что делает эта страница, —
 * это заблуждение снимает.
 *
 * В некастодиальном кошельке пароля для восстановления не существует.
 * Он никуда не отправляется и нигде не хранится: из него выводится ключ
 * шифрования, и без пароля зашифрованное хранилище не открыть никому,
 * включая разработчиков.
 *
 * Единственный доступный путь — стереть кошелёк с устройства и создать
 * его заново из seed-фразы. Пользователь без записанной фразы потеряет
 * средства безвозвратно, и страница обязана сказать это прямо, а не
 * спрятать в мелком шрифте под кнопкой.
 *
 * ПОЧЕМУ ДВА ПОДТВЕРЖДЕНИЯ. Флажок отсекает случайное нажатие,
 * ввод слова — механическое проставление галочек не читая. Операция
 * необратима и не требует пароля (в этом весь смысл экрана), поэтому
 * единственная защита от ошибки — заставить остановиться.
 */
export function ForgotPasswordPage() {
  const onboarding = useOnboarding()
  const navigate = useNavigate()

  const [hasPhrase, setHasPhrase] = useState(false)
  const [typedWord, setTypedWord] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const canReset = hasPhrase && typedWord.trim().toUpperCase() === CONFIRMATION_WORD && !isBusy

  const handleReset = async () => {
    setError(null)
    setIsBusy(true)

    try {
      await onboarding.reset()
      await navigate('/')
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : 'The wallet could not be erased')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-start justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link to="/unlock">
              <ArrowLeft />
              Back
            </Link>
          </Button>

          <CardTitle>Erase the wallet from this device</CardTitle>
          <CardDescription>
            The only path both to a forgotten password and to another wallet on this device
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Alert variant="danger">
            <TriangleAlert />
            <AlertTitle>The reset destroys the data on this device</AlertTitle>
            <AlertDescription>
              The wallet can then be restored only from a seed phrase of 12 or 24 words. If the
              phrase is not written down, the funds are lost for good — neither we nor anyone else
              will be able to return them.
            </AlertDescription>
          </Alert>

          {/* ЭКРАН ОТВЕЧАЕТ НА ДВА РАЗНЫХ ВОПРОСА, и оба надо назвать.
              Прежде он говорил только о забытом пароле, и человек,
              который пароль помнит, но хочет другой кошелёк, не понимал,
              туда ли попал. */}
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Why people come here</p>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">A forgotten password.</span> It cannot
                be restored: it is never sent anywhere and never stored, and the encryption key is
                derived from it. Without the password nobody can open the storage, developers
                included.
              </li>
              <li>
                <span className="font-medium text-foreground">Another wallet is needed.</span> A
                device holds one wallet. Creating a new one or restoring a different seed phrase is
                possible only in place of the current one — hence the same path.
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">How it works</p>
            <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>1. The wallet is erased from this device together with the encrypted keys.</li>
              <li>
                2. You create a new wallet or enter a seed phrase — your previous one or another.
              </li>
              <li>3. You choose a new password. Every account is restored from the phrase.</li>
            </ol>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <Label className="items-start gap-3">
              <Checkbox
                checked={hasPhrase}
                disabled={isBusy}
                onChange={(event) => {
                  setHasPhrase(event.target.checked)
                }}
              />
              <span className="text-sm leading-snug font-normal">
                I have the seed phrase written down and understand that without it access to the
                funds will be lost
              </span>
            </Label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmation-word">
                Type the word {CONFIRMATION_WORD} to confirm
              </Label>
              <Input
                id="confirmation-word"
                value={typedWord}
                disabled={!hasPhrase || isBusy}
                autoComplete="off"
                autoCapitalize="characters"
                onChange={(event) => {
                  setTypedWord(event.target.value)
                }}
              />
            </div>
          </div>

          {error !== null && (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button asChild variant="outline" className="flex-1">
              <Link to="/unlock">Go back</Link>
            </Button>

            <Button
              variant="destructive"
              className="flex-1"
              disabled={!canReset}
              onClick={() => {
                void handleReset()
              }}
            >
              {isBusy ? 'Erasing…' : 'Erase the wallet'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
