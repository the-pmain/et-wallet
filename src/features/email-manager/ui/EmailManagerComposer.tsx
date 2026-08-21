import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AdminAuthError, useAdminSession } from '@/features/admin'
import { Alert, AlertDescription, Button } from '@/shared/ui'

import {
  EMAIL_HTML_TEMPLATE,
  MOCK_FROM,
  MOCK_SUBJECT,
  MOCK_TEXT,
  MOCK_TO,
} from '../model/template'

/**
 * Предпросмотр зашитого макета и кнопка отправки.
 *
 * Полей нет: отправитель, получатель и тело — константы.
 */
export function EmailManagerComposer() {
  const { client, lock } = useAdminSession()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    void client
      .getEmailStatus()
      .then((status) => {
        if (!cancelled) {
          setConfigured(status.configured)
        }
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
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

  const handleSend = () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)

    void client
      .sendEmail({
        from: MOCK_FROM,
        to: MOCK_TO,
        subject: MOCK_SUBJECT,
        html: EMAIL_HTML_TEMPLATE,
        text: MOCK_TEXT,
      })
      .then((result) => {
        const delivered = result.delivered.length
        const queued = result.queued.length

        setMessage(
          delivered > 0
            ? `Sent to ${result.delivered.join(', ')}.`
            : queued > 0
              ? `Queued for ${result.queued.join(', ')}.`
              : 'Cloudflare accepted the message.',
        )
      })
      .catch((caught: unknown) => {
        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()

          return
        }

        setError(caught instanceof AdminAuthError ? caught.message : 'The email could not be sent.')
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Email manager</h1>
        <p className="text-sm text-muted-foreground">
          Mock template from {MOCK_FROM}. Preview below, then send.
        </p>
      </div>

      {configured === false ? (
        <Alert variant="warning">
          <AlertDescription>
            Email sending is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on
            the server. A Global API Key (cfk_) also needs CLOUDFLARE_EMAIL. Then restart.
          </AlertDescription>
        </Alert>
      ) : null}

      {error !== null ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {message !== null ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Button type="button" disabled={busy} onClick={handleSend}>
          <Send />
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </div>

      <iframe
        title="Preview"
        sandbox=""
        srcDoc={EMAIL_HTML_TEMPLATE}
        className="min-h-[640px] w-full rounded-xl border bg-[#0d0b18]"
      />
    </div>
  )
}
