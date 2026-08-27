import { ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { AdminAuthError, type IAdminEmailMessage, useAdminSession } from '@/features/admin'
import { Alert, AlertDescription, Button, Input, Skeleton } from '@/shared/ui'

import {
  conversationMatchesQuery,
  groupMessagesIntoConversations,
} from '../model/conversations'
import { MAILBOX_PAGE_SIZE } from '../model/mailbox'
import { ConversationAvatar } from './ConversationAvatar'
import { EmailConfiguredAlert } from './EmailConfiguredAlert'
import { EmailStorageAlert } from './EmailStorageAlert'
import { MailboxPager } from './MailboxPager'

/**
 * Conversation list styled like the admin users directory.
 */
export function EmailConversationsList() {
  const { client, lock } = useAdminSession()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly IAdminEmailMessage[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const [status, page] = await Promise.all([
        client.getEmailStatus(),
        client.listEmailMessages({ limit: MAILBOX_PAGE_SIZE, cursor }),
      ])

      return { status, page }
    },
    [client],
  )

  useEffect(() => {
    let cancelled = false

    void loadPage(null)
      .then(({ status, page }) => {
        if (cancelled) {
          return
        }

        setConfigured(status.configured)
        setStorageWarning(status.storageWarning)
        setMessages(page.messages)
        setNextCursor(page.nextCursor)
        setCursorStack([null])
        setPageIndex(0)
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
  }, [loadPage, lock])

  const goTo = async (cursor: string | null, nextIndex: number, stack: Array<string | null>) => {
    setBusy(true)
    setError(null)

    try {
      const { page } = await loadPage(cursor)

      setMessages(page.messages)
      setNextCursor(page.nextCursor)
      setCursorStack(stack)
      setPageIndex(nextIndex)
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setError(
        caught instanceof AdminAuthError
          ? caught.message
          : 'The conversation list could not be loaded.',
      )
    } finally {
      setBusy(false)
    }
  }

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

  if (error !== null && messages === null) {
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
            {conversations.length === 1 ? 'conversation' : 'conversations'} on this page.
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

      {error !== null ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

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

      <MailboxPager
        page={pageIndex + 1}
        hasPrevious={pageIndex > 0}
        hasNext={nextCursor !== null}
        busy={busy}
        onPrevious={() => {
          void goTo(cursorStack[pageIndex - 1] ?? null, pageIndex - 1, cursorStack)
        }}
        onNext={() => {
          if (nextCursor === null) {
            return
          }

          void goTo(nextCursor, pageIndex + 1, [...cursorStack.slice(0, pageIndex + 1), nextCursor])
        }}
      />
    </div>
  )
}
