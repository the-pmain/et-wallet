import { Copy, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

interface SeedPhraseDisplayProps {
  readonly words: readonly string[]
  onCopy?: () => void
}

/**
 * Shows the mnemonic phrase when creating a wallet.
 *
 * HONESTY BOUNDARY. Project rule: secrets do not enter UI state.
 * Here that rule is inevitably broken: the phrase must be shown, so
 * it exists as a string in the React tree and in tab memory.
 * JavaScript strings cannot be wiped. That cannot be fixed, so:
 *
 * - the phrase is not lifted into global state and does not outlive
 *   the screen;
 * - words stay hidden until an explicit user action — a glance over
 *   the shoulder or a window screenshot will not reveal them at once;
 * - clipboard and screenshot warnings sit next to the phrase, not
 *   buried in help.
 *
 * `user-select` is left on: the user must be able to highlight the
 * phrase and write it down by hand.
 */
export function SeedPhraseDisplay({ words, onCopy }: SeedPhraseDisplayProps) {
  const [isRevealed, setIsRevealed] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="danger">
        <AlertTitle>Write the phrase down on paper</AlertTitle>
        <AlertDescription>
          This is the only way to restore the wallet. We keep no copy of it and cannot restore
          access. Do not photograph the screen and do not save the phrase in notes — they sync to
          the cloud.
        </AlertDescription>
      </Alert>

      <div className="relative">
        <ol
          className={cn(
            'grid grid-cols-3 gap-2 rounded-lg border p-4',
            !isRevealed && 'blur-sm select-none',
          )}
          aria-hidden={!isRevealed}
        >
          {words.map((word, index) => (
            <li
              key={`${String(index)}-${word}`}
              className="flex items-baseline gap-2 rounded-md bg-muted px-2 py-1.5 text-sm"
            >
              <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="font-medium">{word}</span>
            </li>
          ))}
        </ol>

        {!isRevealed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button
              variant="secondary"
              onClick={() => {
                setIsRevealed(true)
              }}
            >
              <Eye />
              Show the phrase
            </Button>
          </div>
        )}
      </div>

      {isRevealed && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsRevealed(false)
            }}
          >
            <EyeOff />
            Hide
          </Button>

          {onCopy !== undefined && (
            <Button variant="ghost" size="sm" onClick={onCopy}>
              <Copy />
              Copy
            </Button>
          )}
        </div>
      )}

      {isRevealed && onCopy !== undefined && (
        <p className="text-xs text-muted-foreground">
          The clipboard is available to other applications and may be kept in history. Copying the
          phrase by hand is safer.
        </p>
      )}
    </div>
  )
}
