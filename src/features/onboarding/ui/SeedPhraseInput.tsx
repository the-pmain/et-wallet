import { Check } from 'lucide-react'
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
  [MNEMONIC_INVALID_REASON.Empty]: 'Enter the phrase',
  [MNEMONIC_INVALID_REASON.WordCount]: `Allowed word counts: ${VALID_WORD_COUNTS.join(', ')}`,
  [MNEMONIC_INVALID_REASON.UnknownWord]:
    'Some words are missing from the word list — check the spelling',
  [MNEMONIC_INVALID_REASON.Checksum]:
    'The words are valid, but the checksum does not match — the order is probably wrong',
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
      {/* СЧЁТЧИК СЛОВ — У ПОДПИСИ, А НЕ ПОД ПОЛЕМ. Он отвечает на
          единственный вопрос, который человек задаёт себе, набирая
          фразу: «сколько уже». Стоя под полем, он оказывался ниже
          взгляда, занятого набором, и его находили не сразу.

          Двенадцать и двадцать четыре — единственные допустимые
          значения, поэтому счётчик показывает не «сколько введено»,
          а «сколько из скольких»: цель названа вместе с достигнутым. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={inputId}>Seed phrase</Label>

        <span className="text-xs text-muted-foreground">
          Words{' '}
          <span className="font-medium text-foreground tabular-nums">
            {validation.wordCount}
            <span className="text-muted-foreground"> / 12 or 24</span>
          </span>
        </span>
      </div>

      <Textarea
        id={inputId}
        value={value}
        disabled={disabled}
        rows={4}
        placeholder="Enter 12 or 24 words separated by spaces"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={shouldShowError}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />

      {validation.isValid && (
        <p className="flex items-center gap-1.5 text-xs text-risk-low">
          <Check className="size-3.5 shrink-0" aria-hidden />
          The phrase is valid
        </p>
      )}

      {shouldShowError && validation.reason !== null && (
        <p className="text-xs text-risk-high">{REASON_TEXT[validation.reason]}</p>
      )}

      {shouldShowError && validation.unknownWordIndexes.length > 0 && (
        <p className="text-xs text-risk-high">
          Check the words at positions:{' '}
          {validation.unknownWordIndexes.map((index) => index + 1).join(', ')}
        </p>
      )}
    </div>
  )
}
