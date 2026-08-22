import { useEffect, useMemo } from 'react'

import type { IAdminEmailMessage } from '@/features/admin'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui'

import {
  messageDisplayText,
  messageIsBrandedTemplate,
  shouldShowHtmlPreview,
} from '../model/message-body'

export function EmailMessageBubble({ message }: { readonly message: IAdminEmailMessage }) {
  const isSent = message.direction === 'sent'
  const isTemplate = messageIsBrandedTemplate(message)
  const showHtmlFrame = shouldShowHtmlPreview(message)
  const bodyText = messageDisplayText(message)

  const previewUrl = useMemo(() => {
    if (!showHtmlFrame || message.html === null) {
      return null
    }

    return URL.createObjectURL(new Blob([message.html], { type: 'text/html' }))
  }, [message.html, showHtmlFrame])

  useEffect(() => {
    return () => {
      if (previewUrl !== null) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  return (
    <li
      className={cn('flex', isSent ? 'justify-end' : 'justify-start')}
      aria-label={isSent ? 'Sent message' : 'Received message'}
    >
      <article
        className={cn(
          'flex max-w-[min(100%,44rem)] flex-col gap-3 rounded-2xl border px-4 py-3 shadow-xs',
          isSent
            ? 'border-primary/30 bg-primary/10'
            : 'border-border bg-muted/40',
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{message.subject}</p>
              {isTemplate ? <Badge variant="secondary">Template</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {isSent ? `You → ${message.to}` : `${message.from} → you`}
            </p>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleString()} · {message.status}
          </p>
        </header>

        {showHtmlFrame && previewUrl !== null ? (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-[#0d0b18]">
            <iframe
              title={`Email template preview ${message.id}`}
              sandbox=""
              src={previewUrl}
              className="block min-h-[360px] w-full"
            />
          </div>
        ) : null}

        {bodyText !== null ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90">{bodyText}</p>
        ) : null}
      </article>
    </li>
  )
}
