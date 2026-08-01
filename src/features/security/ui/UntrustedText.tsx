import { EyeOff } from 'lucide-react'

import { toSafeText } from '@/core'
import { cn } from '@/shared/lib/utils'

interface UntrustedTextProps {
  /** Строка из контракта, из конфигурации сети либо от стороннего сервиса. */
  readonly value: string

  readonly className?: string
}

/**
 * Показ строки, которую написали не мы.
 *
 * ЧТО ЭТО ЗА СТРОКИ. Символ и имя токена задаёт автор контракта. Имя
 * сети — тот, кто её добавил. Текст уведомления приходит со справочного
 * сервиса. Все они показываются рядом с суммами и адресами, и все могут
 * содержать невидимые символы либо переопределение направления письма.
 *
 * СКРЫТЫЕ СИМВОЛЫ ЗАМЕНЯЮТСЯ МАРКЕРОМ, А СТРОКА ПОМЕЧАЕТСЯ ЗНАЧКОМ.
 * Молчаливое удаление сделало бы подделку неотличимой от оригинала —
 * ровно то, чего добивался её автор. Значок рядом означает: эта строка
 * содержала то, чего вы не видите.
 */
export function UntrustedText({ value, className }: UntrustedTextProps) {
  const safe = toSafeText(value)

  if (!safe.hasHiddenCharacters) {
    return <span className={className}>{safe.text}</span>
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-risk-high', className)}>
      {safe.text}
      <EyeOff
        className="size-3.5 shrink-0"
        aria-label="Строка содержала скрытые символы — возможна подделка"
      />
    </span>
  )
}
