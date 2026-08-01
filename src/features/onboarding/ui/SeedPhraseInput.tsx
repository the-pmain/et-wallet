import { useId } from 'react'

import {
  MNEMONIC_INVALID_REASON,
  VALID_WORD_COUNTS,
  type IMnemonicValidationResult,
  type MnemonicInvalidReason,
} from '@/core'
import { Label, Textarea } from '@/shared/ui'

/** Пояснения к причинам отказа. Коды приходят из ядра, тексты — отсюда. */
const REASON_TEXT: Readonly<Record<MnemonicInvalidReason, string>> = {
  [MNEMONIC_INVALID_REASON.Empty]: 'Введите фразу',
  [MNEMONIC_INVALID_REASON.WordCount]: `Допустимо ${VALID_WORD_COUNTS.join(', ')} слов`,
  [MNEMONIC_INVALID_REASON.UnknownWord]: 'Некоторых слов нет в словаре — проверьте написание',
  [MNEMONIC_INVALID_REASON.Checksum]:
    'Слова верные, но контрольная сумма не сходится — вероятно, перепутан порядок',
}

interface SeedPhraseInputProps {
  readonly value: string
  readonly validation: IMnemonicValidationResult
  readonly disabled?: boolean
  onChange: (value: string) => void
}

/**
 * Ввод существующей мнемонической фразы.
 *
 * Ошибка показывается только когда пользователь ввёл достаточно слов:
 * подсветка «фраза некорректна» после первого же символа приучает
 * не читать сообщения об ошибках.
 *
 * Позиции неизвестных слов выводятся отдельно. Это единственная подсказка,
 * которая реально помогает: в 24 словах найти опечатку глазами тяжело,
 * а ошибка в одном слове означает потерю доступа к средствам.
 *
 * Атрибуты автозаполнения и автокоррекции выключены: подстановка сохранённого
 * значения в поле seed-фразы и исправление слова мобильной клавиатурой
 * одинаково приводят к неверной фразе.
 */
export function SeedPhraseInput({
  value,
  validation,
  disabled = false,
  onChange,
}: SeedPhraseInputProps) {
  const inputId = useId()
  const shouldShowError = value.trim().length > 0 && !validation.isValid && validation.wordCount > 0

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>Мнемоническая фраза</Label>

      <Textarea
        id={inputId}
        value={value}
        disabled={disabled}
        rows={4}
        placeholder="Введите 12 или 24 слова через пробел"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={shouldShowError}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Слов: {validation.wordCount}</p>

        {validation.isValid && <p className="text-xs text-risk-low">Фраза корректна</p>}
      </div>

      {shouldShowError && validation.reason !== null && (
        <p className="text-xs text-risk-high">{REASON_TEXT[validation.reason]}</p>
      )}

      {shouldShowError && validation.unknownWordIndexes.length > 0 && (
        <p className="text-xs text-risk-high">
          Проверьте слова на позициях:{' '}
          {validation.unknownWordIndexes.map((index) => index + 1).join(', ')}
        </p>
      )}
    </div>
  )
}
