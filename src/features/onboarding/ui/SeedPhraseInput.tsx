import { Check } from 'lucide-react'
import { useId } from 'react'

import {
  MNEMONIC_INVALID_REASON,
  VALID_WORD_COUNTS,
  type IMnemonicValidationResult,
  type MnemonicInvalidReason,
} from '@/core'
import { Label, Textarea } from '@/shared/ui'

/** Rejection reasons. Codes come from the core; the copy lives here. */
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
 * Input for an existing mnemonic phrase.
 *
 * An error is shown only after enough words are entered: highlighting
 * "phrase is invalid" after the first character trains people not to
 * read error messages.
 *
 * Unknown-word positions are listed separately. That is the only hint
 * that actually helps: finding a typo among 24 words by eye is hard,
 * and a single wrong word means losing access to funds.
 *
 * Autofill and autocorrect are off: inserting a saved value into a
 * seed-phrase field and a mobile keyboard "fixing" a word both produce
 * the wrong phrase.
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
      {/* WORD COUNT SITS ON THE LABEL, NOT UNDER THE FIELD. It answers
          the only question someone asks while typing the phrase:
          "how many so far". Under the field it sat below the gaze
          busy with typing and was found late.

          Twelve and twenty-four are the only allowed counts, so the
          counter shows "how many of how many": the target is named
          with the progress. */}
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
