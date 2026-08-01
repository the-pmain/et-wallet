import { useId } from 'react'

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_ISSUE,
  PASSWORD_STRENGTH,
  assessPassword,
  type PasswordIssue,
} from '@/core'
import { cn } from '@/shared/lib/utils'
import { Input, Label } from '@/shared/ui'

/** Пояснения к нарушенным правилам. Коды приходят из ядра, тексты — отсюда. */
const ISSUE_TEXT: Readonly<Record<PasswordIssue, string>> = {
  [PASSWORD_ISSUE.TooShort]: `не короче ${String(MIN_PASSWORD_LENGTH)} символов`,
  [PASSWORD_ISSUE.TooLong]: 'слишком длинный',
  [PASSWORD_ISSUE.TooFewClasses]: 'смешайте строчные, заглавные, цифры и знаки',
  [PASSWORD_ISSUE.Common]: 'слишком распространённый',
  [PASSWORD_ISSUE.Repetitive]: 'состоит из повторяющегося фрагмента',
}

const STRENGTH_TEXT = {
  [PASSWORD_STRENGTH.Weak]: 'слабый',
  [PASSWORD_STRENGTH.Fair]: 'приемлемый',
  [PASSWORD_STRENGTH.Strong]: 'хороший',
} as const

const STRENGTH_COLOR = {
  [PASSWORD_STRENGTH.Weak]: 'text-risk-high',
  [PASSWORD_STRENGTH.Fair]: 'text-risk-medium',
  [PASSWORD_STRENGTH.Strong]: 'text-risk-low',
} as const

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
 * Оценка качества берётся из ядра: правила — доменное решение, а не
 * особенность интерфейса. Здесь только отображение.
 *
 * `autoComplete="new-password"` подсказывает менеджеру паролей, что это
 * создание, а не вход, — иначе он предложит подставить пароль от чужой
 * учётной записи. `autoCapitalize` и `autoCorrect` выключены: мобильная
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
  const assessment = assessPassword(password)
  const isMismatched = confirmation.length > 0 && confirmation !== password

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>Пароль</Label>
        <Input
          id={passwordId}
          type="password"
          value={password}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={password.length > 0 && !assessment.isAcceptable}
          onChange={(event) => {
            onPasswordChange(event.target.value)
          }}
        />

        {password.length > 0 && (
          <p className={cn('text-xs', STRENGTH_COLOR[assessment.strength])}>
            Пароль {STRENGTH_TEXT[assessment.strength]}
            {assessment.issues.length > 0 &&
              `: ${assessment.issues.map((issue) => ISSUE_TEXT[issue]).join('; ')}`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={confirmationId}>Повторите пароль</Label>
        <Input
          id={confirmationId}
          type="password"
          value={confirmation}
          disabled={disabled}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={isMismatched}
          onChange={(event) => {
            onConfirmationChange(event.target.value)
          }}
        />

        {isMismatched && <p className="text-xs text-risk-high">Пароли не совпадают</p>}
      </div>
    </div>
  )
}
