import { Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { SENDING_STATUS, type IRemoteSending } from '@/features/onboarding'
import { shortenAddress } from '@/features/wallet'
import { Button } from '@/shared/ui'

import { AdminAuthError, type IAdminSendingPatch } from '../model/AdminClient'
import { useAdminSession } from '../model/admin-context'
import {
  MAX_VISIBLE_PENDING_TOASTS,
  applyLivePendingEvent,
  hydratePendingQueue,
  sendingAmountLabel,
} from '../model/admin-pending-toasts'
import { formatAdminTimestampParts } from '../lib/format-admin-timestamp'
import { useAdminSendingsLive } from '../model/admin-sendings-live'
import { SendingEditDialog } from './SendingEditDialog'
import { SendingStatusBadge } from './SendingStatusBadge'

/**
 * Urgent notice of a pending send.
 *
 * WHY IN THE SHELL, NOT THE SENDINGS TAB. The admin usually sits in
 * users. Waiting for a tab switch means learning about a transfer
 * after the user is already waiting.
 *
 * WHY BOTTOM-RIGHT, NOT TOP. Header and Lock live top-right.
 * Ordinary wallet toasts are top too, but the cabinet has none:
 * this is a work queue, not a tip. The card grows up from the
 * corner; the newest, with a large Handle button, is nearest
 * finger and mouse.
 *
 * WHY IT DOES NOT AUTO-DISMISS. Four seconds is enough to read
 * "saved" and not enough to press Handle. The card stays until
 * the transfer is handled or the card is closed.
 *
 * WHY ALSO A LIST ON ENTER. The stream reports only new frames.
 * Transfers that appeared while the cabinet was closed would
 * otherwise stay invisible until the next create.
 */
export function AdminPendingSendingToasts() {
  const { client, lock } = useAdminSession()
  const [queue, setQueue] = useState<readonly IRemoteSending[]>([])
  const [editing, setEditing] = useState<IRemoteSending | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void client
      .listSendings()
      .then((listed) => {
        if (!cancelled) {
          setQueue((current) => hydratePendingQueue(current, listed))
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }

        if (caught instanceof AdminAuthError && caught.status === 401) {
          lock()
        }
      })

    return () => {
      cancelled = true
    }
  }, [client, lock])

  useAdminSendingsLive((event) => {
    setQueue((current) => applyLivePendingEvent(current, event))
  })

  const visible = queue.slice(0, MAX_VISIBLE_PENDING_TOASTS)
  const hiddenCount = queue.length - visible.length

  async function saveSending(id: string, patch: IAdminSendingPatch): Promise<void> {
    setSaving(true)
    setEditError(null)

    try {
      const updated = await client.updateSending(id, patch)
      setQueue((current) =>
        updated.status === SENDING_STATUS.Pending
          ? current.map((item) => (item.id === id ? updated : item))
          : current.filter((item) => item.id !== id),
      )
      setEditing(null)
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()

        return
      }

      setEditError('The sending could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function dismiss(id: string): void {
    setQueue((current) => current.filter((item) => item.id !== id))

    if (editing?.id === id && !isSaving) {
      setEditing(null)
      setEditError(null)
    }
  }

  return (
    <>
      {visible.length === 0 ? null : (
        <div
          className="pointer-events-none fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-50 ml-auto flex w-full max-w-md flex-col-reverse gap-2 sm:left-auto sm:w-[min(calc(100%-2rem),24rem)]"
          aria-live="assertive"
          aria-relevant="additions"
        >
          {visible.map((sending) => (
            <PendingSendingCard
              key={sending.id}
              sending={sending}
              onEdit={() => {
                setEditError(null)
                setEditing(sending)
              }}
              onDismiss={() => {
                dismiss(sending.id)
              }}
            />
          ))}
          {hiddenCount > 0 ? (
            <Link
              to="/admin/sendings"
              className="pointer-events-auto flex min-h-12 items-center justify-center rounded-xl border border-risk-medium/40 bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-raised"
            >
              {hiddenCount === 1
                ? '1 more pending sending'
                : `${String(hiddenCount)} more pending sendings`}
            </Link>
          ) : null}
        </div>
      )}
      <SendingEditDialog
        key={editing?.id ?? 'closed'}
        sending={editing}
        isBusy={isSaving}
        error={editError}
        onClose={() => {
          if (!isSaving) {
            setEditing(null)
            setEditError(null)
          }
        }}
        onSave={(id, patch) => {
          void saveSending(id, patch)
        }}
      />
    </>
  )
}

function PendingSendingCard({
  sending,
  onEdit,
  onDismiss,
}: {
  readonly sending: IRemoteSending
  readonly onEdit: () => void
  readonly onDismiss: () => void
}) {
  const amount = sendingAmountLabel(sending)
  const recipient = sending.recipientAddress
  const handleName = amount === null ? 'Handle pending sending' : `Handle pending sending ${amount}`
  const timestamp = formatAdminTimestampParts(sending.createdAt)

  return (
    <article
      role="alert"
      className="pointer-events-auto flex animate-in flex-col gap-4 rounded-xl border border-risk-medium/50 bg-risk-medium/10 p-4 text-card-foreground shadow-raised backdrop-blur-md duration-200 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full bg-risk-medium ring-4 ring-risk-medium/25 motion-safe:animate-pulse"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold tracking-tight">Pending sending added</p>
            <SendingStatusBadge status={sending.status} />
          </div>
          {amount === null ? null : (
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{amount}</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            User {sending.userId ?? '—'}
            {recipient === null || recipient === '' ? null : ` · ${shortenAddress(recipient)}`}
          </p>
          {timestamp === null ? null : (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <time
                dateTime={sending.createdAt}
                className="text-xl font-semibold tracking-tight text-foreground/75 tabular-nums"
              >
                {timestamp.time}
              </time>
              <span className="text-sm text-muted-foreground">{timestamp.date}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss pending sending"
          className="tap-target focus-ring -mt-1 -mr-1 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <Button
        type="button"
        className="h-16 min-h-16 w-full text-lg font-semibold"
        aria-label={handleName}
        onClick={onEdit}
      >
        <Pencil className="size-6" aria-hidden />
        Handle
      </Button>
    </article>
  )
}
