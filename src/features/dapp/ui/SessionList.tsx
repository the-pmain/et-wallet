import { Globe, Link2Off, Plug } from 'lucide-react'

import type { IDappSession } from '@/core'
import { UntrustedText } from '@/features/security'
import { Badge, Button, EmptyState } from '@/shared/ui'

interface SessionListProps {
  readonly sessions: readonly IDappSession[]
  readonly isBusy: boolean
  readonly onDisconnect: (sessionId: string) => void
}

/**
 * Действующие подключения.
 *
 * СПИСОК ПОКАЗЫВАЕТ, ЧТО ИМЕННО ОТКРЫТО. Подключение, о котором
 * владелец не помнит, — это открытый канал, по которому в любой момент
 * придёт запрос на подпись. Возможность его закрыть обязана быть
 * на виду, а не в глубине настроек.
 *
 * ПОКАЗЫВАЕТСЯ СРОК ДЕЙСТВИЯ. Подключение живёт неделями и переживает
 * закрытие вкладки: без даты пользователь считает, что оно закончилось
 * вместе с сеансом работы.
 */
export function SessionList({ sessions, isBusy, onDisconnect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="Подключений нет"
        description="Ни одно приложение сейчас не подключено к кошельку. Подключение начинается на стороне приложения — оно покажет код или ссылку."
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
              <UntrustedText
                value={session.dapp.name === '' ? 'Приложение без имени' : session.dapp.name}
              />
            </span>

            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              <UntrustedText
                value={session.dapp.url === '' ? 'адрес не указан' : session.dapp.url}
              />
            </span>

            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline">
                {session.chainIds.length === 1
                  ? `сеть ${session.chainIds[0]?.toString() ?? ''}`
                  : `сетей: ${String(session.chainIds.length)}`}
              </Badge>

              {session.expiresAt === null ? null : (
                <span>действует до {new Date(session.expiresAt).toLocaleDateString('ru-RU')}</span>
              )}
            </span>
          </span>

          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            aria-label={`Отключить ${session.dapp.name}`}
            onClick={() => {
              onDisconnect(session.id)
            }}
          >
            <Link2Off className="size-4" aria-hidden />
            Отключить
          </Button>
        </li>
      ))}
    </ul>
  )
}
