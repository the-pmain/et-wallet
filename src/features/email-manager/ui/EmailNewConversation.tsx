import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { AdminAuthError, useAdminSession } from '@/features/admin'
import { Alert, AlertDescription, Button } from '@/shared/ui'

import { conversationIdForEmail } from '../model/conversations'
import { MOCK_FROM } from '../model/template'
import { EmailComposer, type IEmailComposerSendPayload } from './EmailComposer'
import { EmailConfiguredAlert } from './EmailConfiguredAlert'
import { EmailStorageAlert } from './EmailStorageAlert'

/** Compose and send the first message in a new conversation. */
export function EmailNewConversation() {
  const navigate = useNavigate()
  const { client, lock } = useAdminSession()

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<readonly string[]>([])
  const [from, setFrom] = useState(MOCK_FROM)
  const [to, setTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    void Promise.all([client.getEmailStatus(), client.listEmailRecipients()])
      .then(([status, listedRecipients]) => {
        if (cancelled) {
          return
        }

        setConfigured(status.configured)
        setStorageWarning(status.storageWarning)
        setRecipients(listedRecipients)
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
        setError(
          caught instanceof AdminAuthError
            ? caught.message
            : 'Could not load email settings.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

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

      navigate(`/email-manager/${conversationIdForEmail(payload.to)}`)
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

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New conversation</h1>
        <p className="text-sm text-muted-foreground">
          Pick a template or write a custom message to start a thread.
        </p>
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

      <EmailComposer
        from={from}
        to={to}
        recipients={recipients}
        busy={busy}
        onFromChange={setFrom}
        onToChange={setTo}
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
