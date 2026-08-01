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
        <AlertTitle>Запишите фразу на бумаге</AlertTitle>
        <AlertDescription>
          Это единственный способ восстановить кошелёк. Мы не храним её копию и не сможем
          восстановить доступ. Не фотографируйте экран и не сохраняйте фразу в заметках — они
          синхронизируются в облако.
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
              Показать фразу
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
            Скрыть
          </Button>

          {onCopy !== undefined && (
            <Button variant="ghost" size="sm" onClick={onCopy}>
              <Copy />
              Копировать
            </Button>
          )}
        </div>
      )}

      {isRevealed && onCopy !== undefined && (
        <p className="text-xs text-muted-foreground">
          Буфер обмена доступен другим приложениям и может сохраняться в истории. Надёжнее
          переписать фразу вручную.
        </p>
      )}
    </div>
  )
}
