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
const CONFIRMATION_WORD = 'СТЕРЕТЬ'

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
      setError(isAppError(caught) ? caught.message : 'Не удалось стереть кошелёк')
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
              Назад
            </Link>
          </Button>

          <CardTitle>Пароль восстановить нельзя</CardTitle>
          <CardDescription>
            Это некастодиальный кошелёк: пароль никуда не отправляется и нигде не хранится
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Alert variant="danger">
            <TriangleAlert />
            <AlertTitle>Сброс уничтожит данные на этом устройстве</AlertTitle>
            <AlertDescription>
              Восстановить кошелёк можно будет только по seed-фразе из 12 или 24 слов. Если фраза не
              записана, средства будут потеряны безвозвратно — ни мы, ни кто-либо другой не сможет
              их вернуть.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Как это работает</p>
            <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>1. Кошелёк стирается с этого устройства вместе с зашифрованными ключами.</li>
              <li>2. Вы вводите seed-фразу заново на экране импорта.</li>
              <li>3. Придумываете новый пароль. Все аккаунты восстанавливаются из фразы.</li>
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
                У меня есть записанная seed-фраза, и я понимаю, что без неё доступ к средствам будет
                потерян
              </span>
            </Label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmation-word">
                Введите слово {CONFIRMATION_WORD} для подтверждения
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
              <Link to="/unlock">Вернуться</Link>
            </Button>

            <Button
              variant="destructive"
              className="flex-1"
              disabled={!canReset}
              onClick={() => {
                void handleReset()
              }}
            >
              {isBusy ? 'Удаление…' : 'Стереть кошелёк'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
