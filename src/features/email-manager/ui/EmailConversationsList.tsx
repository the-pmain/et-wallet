import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { AdminAuthError, type IAdminEmailMessage, useAdminSession } from '@/features/admin'
import { Alert, AlertDescription, Button, Input, Skeleton } from '@/shared/ui'

import {
  conversationMatchesQuery,
  groupMessagesIntoConversations,
} from '../model/conversations'
import { ConversationAvatar } from './ConversationAvatar'
import { EmailConfiguredAlert } from './EmailConfiguredAlert'
import { EmailStorageAlert } from './EmailStorageAlert'

/**
 * Conversation list styled like the admin users directory.
 */
export function EmailConversationsList() {
  const { client, lock } = useAdminSession()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly IAdminEmailMessage[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void Promise.all([client.getEmailStatus(), client.listEmailMessages()])
      .then(([status, listed]) => {
        if (cancelled) {
          return
        }

        setConfigured(status.configured)
        setStorageWarning(status.storageWarning)
        setMessages(listed)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()

          return
        }

        setConfigured(false)
        setMessages([])
        setError(
          caught instanceof AdminAuthError
            ? caught.message
            : 'The conversation list could not be loaded.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

  const conversations = useMemo(() => {
    if (messages === null) {
      return []
    }

    return groupMessagesIntoConversations(messages)
  }, [messages])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (needle === '') {
      return conversations
    }

    return conversations.filter((entry) => conversationMatchesQuery(entry, needle))
  }, [conversations, query])

  if (error !== null) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (messages === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="text-sm text-muted-foreground">
            {String(conversations.length)}{' '}
            {conversations.length === 1 ? 'conversation' : 'conversations'} in the mailbox.
          </p>
        </div>
        <Button asChild type="button">
          <Link to="/email-manager/new">
            <Plus />
            New conversation
          </Link>
        </Button>
      </div>

      {configured === false ? <EmailConfiguredAlert /> : null}
      {storageWarning !== null ? <EmailStorageAlert message={storageWarning} /> : null}

      <Input
        type="search"
        value={query}
        placeholder="Search email or subject"
        aria-label="Search email or subject"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {conversations.length === 0
            ? 'No conversations yet. Start one with New conversation.'
            : 'No conversations match this search.'}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {filtered.map((conversation) => (
            <li key={conversation.id}>
              <Link
                to={`/email-manager/${conversation.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ConversationAvatar email={conversation.counterparty} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{conversation.counterparty}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {String(conversation.messages.length)}{' '}
                      {conversation.messages.length === 1 ? 'message' : 'messages'} ·{' '}
                      {conversation.lastSubject} ·{' '}
                      {new Date(conversation.lastMessageAt).toLocaleString()}
                    </span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
