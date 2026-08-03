import { EyeOff, Languages } from 'lucide-react'

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
 *
 * СМЕШЕНИЕ ПИСЬМЕННОСТЕЙ ПОМЕЧАЕТСЯ ОТДЕЛЬНО. Скрытых символов в таком
 * имени нет — там обычные видимые буквы, просто из разных алфавитов:
 * `Аave` с кириллической `А` выглядит безупречно. Имя сети сверяется
 * со встроенными, символ токена — с проверенным списком, а имя
 * приложения сверять не с чем: его никто не заверял. Здесь смешение —
 * единственный признак, и он показывается как есть.
 */
export function UntrustedText({ value, className }: UntrustedTextProps) {
  const safe = toSafeText(value)

  if (!safe.hasHiddenCharacters && !safe.hasMixedScripts) {
    return <span className={className}>{safe.text}</span>
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-risk-high', className)}>
      {safe.text}

      {safe.hasHiddenCharacters ? (
        <EyeOff
          className="size-3.5 shrink-0"
          aria-label="The string contained hidden characters — it may be a forgery"
        />
      ) : (
        <Languages
          className="size-3.5 shrink-0"
          aria-label="The name mixes alphabets — it may imitate a familiar one"
        />
      )}
    </span>
  )
}
