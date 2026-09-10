import { Copy, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

interface SeedPhraseDisplayProps {
  readonly words: readonly string[]
  onCopy?: () => void
}

/**
 * Показ мнемонической фразы при создании кошелька.
 *
 * ГРАНИЦА ЧЕСТНОСТИ. Правило проекта — секреты не попадают в состояние UI.
 * Здесь оно неизбежно нарушается: фразу нужно показать, значит она
 * существует строкой в дереве React и в памяти вкладки. Строки в JavaScript
 * неочищаемы. Устранить это нельзя, поэтому:
 *
 * - фраза не поднимается в глобальное состояние и не переживает экран;
 * - слова скрыты до явного действия пользователя — случайный взгляд
 *   через плечо и скриншот окна не раскроют их сразу;
 * - предупреждения о буфере обмена и скриншотах показаны рядом,
 *   а не спрятаны в справке.
 *
 * `user-select` не отключается: пользователю нужно иметь возможность
 * выделить фразу и записать её вручную.
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
