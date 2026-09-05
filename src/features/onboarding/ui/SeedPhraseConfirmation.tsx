import { Button, Label } from '@/shared/ui'

import type { IConfirmationChallenge } from '../lib/confirmation-challenge'

interface SeedPhraseConfirmationProps {
  readonly challenge: IConfirmationChallenge
  readonly answers: readonly (string | null)[]
  onAnswer: (questionIndex: number, word: string) => void
}

/**
 * Checks that the user wrote the phrase down.
 *
 * Multiple choice, not free typing: retyping three words from the
 * keyboard invites copying the phrase through the clipboard, and
 * the check becomes a formality.
 */
export function SeedPhraseConfirmation({
  challenge,
  answers,
  onAnswer,
}: SeedPhraseConfirmationProps) {
  return (
    <div className="flex flex-col gap-5">
      {challenge.positions.map((position, questionIndex) => (
        <div key={position} className="flex flex-col gap-2">
          <Label>Word number {position + 1}</Label>

          <div className="grid grid-cols-2 gap-2">
            {(challenge.options[questionIndex] ?? []).map((option) => (
              <Button
                key={option}
                variant={answers[questionIndex] === option ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => {
                  onAnswer(questionIndex, option)
                }}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
