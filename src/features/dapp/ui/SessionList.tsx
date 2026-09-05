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
 * Active connections.
 *
 * THE LIST SHOWS WHAT IS OPEN. A connection the owner forgot is an
 * open channel that can request a signature at any moment. The
 * ability to close it must be in view, not buried in settings.
 *
 * EXPIRY IS SHOWN. A connection lives for weeks and survives closing
 * the tab: without a date the user thinks it ended with the session.
 */
export function SessionList({ sessions, isBusy, onDisconnect }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="No connections"
        description="No application is connected to the wallet right now. A connection starts on the application side — it shows a code or a link."
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
                value={session.dapp.name === '' ? 'Application without a name' : session.dapp.name}
              />
            </span>

            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              <UntrustedText
                value={session.dapp.url === '' ? 'no address given' : session.dapp.url}
              />
            </span>

            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline">
                {session.chainIds.length === 1
                  ? `network ${session.chainIds[0]?.toString() ?? ''}`
                  : `networks: ${String(session.chainIds.length)}`}
              </Badge>

              {session.expiresAt === null ? null : (
                <span>valid until {new Date(session.expiresAt).toLocaleDateString('en-GB')}</span>
              )}
            </span>
          </span>

          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            aria-label={`Disconnect ${session.dapp.name}`}
            onClick={() => {
              onDisconnect(session.id)
            }}
          >
            <Link2Off className="size-4" aria-hidden />
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  )
}
