import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui'

import { copyWithAutoClear, type ICopyHandle } from '../model/clipboard'

interface SecretRevealProps {
  /** Что показывается. Попадает в подпись, но не в буфер обмена. */
  readonly label: string

  /** Само значение. Строка неочищаема — см. пояснение ниже. */
  readonly value: string

  /** Разрешено ли копирование в буфер обмена. */
  readonly canCopy?: boolean
}

/**
 * Показ секрета одной строкой — приватного ключа, расширенного ключа.
 *
 * ГРАНИЦА ЧЕСТНОСТИ. Показанный секрет существует строкой в дереве React
 * и в памяти вкладки. Строки в JavaScript неочищаемы: значение живёт
 * до сборки мусора, и устранить это нельзя. Смягчения ровно два —
 * значение скрыто до явного действия пользователя, и буфер обмена
 * очищается сам.
 *
 * СКРЫТО ПО УМОЛЧАНИЮ. Экран, открывшийся с готовым ключом на виду,
 * раскрывает его случайному взгляду, демонстрации экрана и скриншоту,
 * сделанному не глядя.
 */
export function SecretReveal({ label, value, canCopy = true }: SecretRevealProps) {
  const [isRevealed, setRevealed] = useState(false)
  const [isCopied, setCopied] = useState(false)

  /* Отмена запланированной очистки нужна при уходе с экрана: таймер,
     переживший компонент, обратился бы к буферу обмена вкладки, которая
     уже занята другим. */
  const copyHandle = useRef<ICopyHandle | null>(null)

  useEffect(() => {
    return () => {
      copyHandle.current?.cancel()
      copyHandle.current = null
    }
  }, [])

  const copy = async () => {
    copyHandle.current?.cancel()
    copyHandle.current = await copyWithAutoClear(value)
    setCopied(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>

      <p
        className={cn(
          'rounded-lg border bg-muted px-3 py-2 font-mono text-xs break-all',
          !isRevealed && 'blur-sm select-none',
        )}
        aria-hidden={!isRevealed}
      >
        {value}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRevealed((current) => !current)
          }}
        >
          {isRevealed ? <EyeOff /> : <Eye />}
          {isRevealed ? 'Скрыть' : 'Показать'}
        </Button>

        {canCopy && isRevealed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void copy()
            }}
          >
            {isCopied ? <Check /> : <Copy />}
            {isCopied ? 'Скопировано' : 'Копировать'}
          </Button>
        )}
      </div>

      {canCopy && isRevealed && (
        <p className="text-xs text-muted-foreground">
          Буфер обмена доступен другим приложениям. Скопированное значение стирается через минуту,
          если вы не скопировали что-то ещё.
        </p>
      )}
    </div>
  )
}
