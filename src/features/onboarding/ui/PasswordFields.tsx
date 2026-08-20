import { useId } from 'react'

import { MAX_PASSWORD_LENGTH } from '@/core'
import { Input, Label } from '@/shared/ui'

interface PasswordFieldsProps {
  readonly password: string
  readonly confirmation: string
  readonly disabled?: boolean
  onPasswordChange: (value: string) => void
  onConfirmationChange: (value: string) => void
}

/**
 * Пара полей «пароль» и «подтверждение».
 *
 * Требований к составу нет: проверяется только совпадение
 * и верхняя граница длины.
 *
 * `autoComplete="new-password"` подсказывает менеджеру паролей, что это
 * создание, а не вход. `autoCapitalize` и `autoCorrect` выключены: мобильная
 * клавиатура иначе изменит первый символ.
 */
export function PasswordFields({
  password,
  confirmation,
  disabled = false,
  onPasswordChange,
  onConfirmationChange,
}: PasswordFieldsProps) {
  const passwordId = useId()
  const confirmationId = useId()
  const isTooLong = password.length > MAX_PASSWORD_LENGTH
  const isMismatched = confirmation.length > 0 && confirmation !== password

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>Password</Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={MAX_PASSWORD_LENGTH}
          aria-invalid={isTooLong}
          onChange={(event) => {
            onPasswordChange(event.target.value)
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={confirmationId}>Repeat the password</Label>
        <Input
          id={confirmationId}
          type="password"
          value={confirmation}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={MAX_PASSWORD_LENGTH}
          aria-invalid={isMismatched}
          onChange={(event) => {
            onConfirmationChange(event.target.value)
          }}
        />

        {isMismatched && <p className="text-xs text-risk-high">The passwords do not match</p>}
      </div>
    </div>
  )
}
