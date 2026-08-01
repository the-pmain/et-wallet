import { KeyRound } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, Button, Input, Label } from '@/shared/ui'

interface ConfirmPasswordProps {
  /** Что именно подтверждается. Показывается пользователю. */
  readonly action: string

  /** Проверка пароля. Возвращает `true`, если пароль верен. */
  readonly onVerify: (password: string) => Promise<boolean>

  /** Вызывается после успешной проверки. */
  readonly onConfirmed: () => void

  readonly onCancel: () => void
}

/**
 * Повторный ввод пароля перед рискованным действием.
 *
 * ОТ ЧЕГО ЭТО ЗАЩИЩАЕТ. От того, кто получил доступ к уже
 * разблокированному кошельку: к оставленному без присмотра устройству,
 * к чужой сессии в общем компьютере, к расширению, дождавшемуся
 * разблокировки. Пароль здесь — не второй фактор, а подтверждение
 * присутствия владельца в момент действия.
 *
 * ПАРОЛЬ НЕ СОХРАНЯЕТСЯ И НЕ ПЕРЕДАЁТСЯ ДАЛЬШЕ. Он уходит в проверку
 * и удаляется из состояния сразу же. Затереть строку в JavaScript
 * невозможно — она живёт до сборки мусора, — но лишняя ссылка
 * из дерева React убирается.
 *
 * СООБЩЕНИЕ ОБ ОШИБКЕ НЕ РАЗЛИЧАЕТ ПРИЧИН. «Неверный пароль»
 * и «хранилище повреждено» — сведения для подбирающего.
 */
export function ConfirmPassword({ action, onVerify, onConfirmed, onCancel }: ConfirmPasswordProps) {
  const passwordId = useId()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const isValid = await onVerify(password)

      /* Пароль удаляется независимо от исхода: при отказе он тем более
         не должен оставаться в дереве компонентов. */
      setPassword('')

      if (isValid) {
        onConfirmed()
      } else {
        setError('Неверный пароль.')
      }
    } catch {
      setError('Проверить пароль не удалось.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          Подтвердите паролем: <span className="font-medium">{action}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>Пароль</Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={isBusy}
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

      {error === null ? null : (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={isBusy}
          onClick={onCancel}
        >
          Отмена
        </Button>

        <Button type="submit" className="flex-1" disabled={isBusy || password.length === 0}>
          {isBusy ? 'Проверка…' : 'Подтвердить'}
        </Button>
      </div>
    </form>
  )
}
