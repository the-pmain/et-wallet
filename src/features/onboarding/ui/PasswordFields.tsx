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
  [PASSWORD_ISSUE.TooShort]: `at least ${String(MIN_PASSWORD_LENGTH)} characters`,
  [PASSWORD_ISSUE.TooLong]: 'too long',
  [PASSWORD_ISSUE.TooFewClasses]: 'mix lower case, upper case, digits and punctuation',
  [PASSWORD_ISSUE.Common]: 'too common',
  [PASSWORD_ISSUE.Repetitive]: 'made of a repeated fragment',
}

const STRENGTH_TEXT = {
  [PASSWORD_STRENGTH.Weak]: 'weak',
  [PASSWORD_STRENGTH.Fair]: 'acceptable',
  [PASSWORD_STRENGTH.Strong]: 'strong',
} as const

/**
 * Цвет отклика.
 *
 * ДВА ЦВЕТА, А НЕ ТРИ, И ЭТО ИСПРАВЛЕНИЕ. Приемлемый пароль подсвечивался
 * жёлтым — цветом предупреждения. Но предупреждать было не о чем:
 * пароль прошёл все правила, кнопка разблокирована, от пользователя
 * ничего не требуется. Жёлтый в этом месте сообщал о несуществующей
 * задаче, а такие сигналы приучают не читать настоящие.
 *
 * Теперь цвет отвечает ровно на один вопрос — годится или нет. Красный:
 * пароль отвергнут, дальше не пустят. Зелёный: принят. Разницу между
 * «приемлемым» и «хорошим» несёт слово, и этого достаточно: она про
 * запас прочности, а не про то, можно ли продолжать.
 */
const STRENGTH_COLOR = {
  [PASSWORD_STRENGTH.Weak]: 'text-risk-high',
  [PASSWORD_STRENGTH.Fair]: 'text-risk-low',
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
        <Label htmlFor={passwordId}>Password</Label>
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
            Password is {STRENGTH_TEXT[assessment.strength]}
            {assessment.issues.length > 0 &&
              `: ${assessment.issues.map((issue) => ISSUE_TEXT[issue]).join('; ')}`}
          </p>
        )}
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
