import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { AdminAuthError, type IAdminEmailMessage, useAdminSession } from '@/features/admin'
import { Alert, AlertDescription, Button, Skeleton } from '@/shared/ui'

import { findConversationById, groupMessagesIntoConversations } from '../model/conversations'
import { MOCK_FROM } from '../model/template'
import { ConversationAvatar } from './ConversationAvatar'
import { EmailComposer, type IEmailComposerSendPayload } from './EmailComposer'
import { EmailConfiguredAlert } from './EmailConfiguredAlert'
import { EmailMessageBubble } from './EmailMessageBubble'
import { EmailStorageAlert } from './EmailStorageAlert'

/** Thread view for one counterparty, with template/custom compose. */
export function EmailConversationView() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { client, lock } = useAdminSession()

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [messages, setMessages] = useState<readonly IAdminEmailMessage[] | null>(null)
  const [from, setFrom] = useState(MOCK_FROM)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadMessages = useCallback(async () => {
    const listed = await client.listEmailMessages()
    setMessages(listed)
  }, [client])

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
            : 'The conversation could not be loaded.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

  const conversation = useMemo(() => {
    if (messages === null || conversationId === undefined) {
      return null
    }

    return findConversationById(groupMessagesIntoConversations(messages), conversationId)
  }, [conversationId, messages])

  const handleSend = async (payload: IEmailComposerSendPayload) => {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const result = await client.sendEmail(payload)
      const delivered = result.delivered.length
      const queued = result.queued.length

      setNotice(
        delivered > 0
          ? `Sent to ${result.delivered.join(', ')}.`
          : queued > 0
            ? `Queued for ${result.queued.join(', ')}.`
            : 'Cloudflare accepted the message.',
      )

      await reloadMessages()
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setError(caught instanceof AdminAuthError ? caught.message : 'The email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  if (messages === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (conversation === null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert variant="danger">
          <AlertDescription>Conversation not found.</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            navigate('/email-manager')
          }}
        >
          Back to conversations
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex items-center gap-3">
        <ConversationAvatar email={conversation.counterparty} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {conversation.counterparty}
          </h1>
          <p className="text-sm text-muted-foreground">
            {String(conversation.messages.length)}{' '}
            {conversation.messages.length === 1 ? 'message' : 'messages'} ·{' '}
            {conversation.sentCount} sent · {conversation.receivedCount} received
          </p>
        </div>
      </div>

      {configured === false ? <EmailConfiguredAlert /> : null}
      {storageWarning !== null ? <EmailStorageAlert message={storageWarning} /> : null}

      {error !== null ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice !== null ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-label="Conversation thread" className="flex flex-col gap-3">
        {conversation.messages.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No messages yet. Send the first message below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {conversation.messages.map((message) => (
              <EmailMessageBubble key={message.id} message={message} />
            ))}
          </ul>
        )}
      </section>

      <EmailComposer
        from={from}
        to={conversation.counterparty}
        toReadOnly
        busy={busy}
        sendLabel="Send message"
        onFromChange={setFrom}
        onSend={handleSend}
      />
    </div>
  )
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
      <Link to="/email-manager">
        <ArrowLeft />
        All conversations
      </Link>
    </Button>
  )
}
