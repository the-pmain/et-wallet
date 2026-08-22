import { useId, useState, type FormEvent } from 'react'

import type { IRemoteSending } from '@/features/onboarding'
import {
  SENDING_STATUS,
  SENDING_STATUSES,
  TOKEN_SYMBOL,
  TOKEN_SYMBOLS,
  type SendingStatus,
} from '@/features/onboarding'
import { Button, Dialog, Input, Label, Textarea } from '@/shared/ui'
import { cn } from '@/shared/lib/utils'

import type { IAdminSendingPatch } from '../model/AdminClient'

interface SendingEditDialogProps {
  readonly sending: IRemoteSending | null
  readonly isBusy: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onSave: (id: string, patch: IAdminSendingPatch) => void
}

/**
 * Правка записи перевода. id, время и userId только для чтения.
 */
export function SendingEditDialog({
  sending,
  isBusy,
  error,
  onClose,
  onSave,
}: SendingEditDialogProps) {
  const fieldId = useId()
  const [draft, setDraft] = useState<IAdminSendingPatch>(() =>
    sending === null ? emptyDraft() : draftFromSending(sending),
  )

  const isOpen = sending !== null

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()

    if (sending === null) {
      return
    }

    onSave(sending.id, {
      status: draft.status,
      failureMessage: draft.failureMessage === '' ? null : draft.failureMessage,
      recipientAddress: draft.recipientAddress.trim(),
      amount: draft.amount.trim(),
      symbol: draft.symbol.trim(),
    })
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit sending"
      description="Status and the other writable fields. Id, time and user stay as they are."
      footer={
        <>
          <Button type="button" variant="ghost" disabled={isBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${fieldId}-form`} disabled={isBusy}>
            {isBusy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {sending === null ? null : (
        <form id={`${fieldId}-form`} className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <ReadonlyField label="id" value={sending.id} />
          <ReadonlyField label="createdAt" value={sending.createdAt} />
          <ReadonlyField label="userId" value={sending.userId ?? '—'} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-symbol`}>symbol</Label>
            <select
              id={`${fieldId}-symbol`}
              name="symbol"
              value={draft.symbol}
              disabled={isBusy}
              className={cn(
                'flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none',
                'focus-ring disabled:cursor-not-allowed disabled:opacity-50',
              )}
              onChange={(event) => {
                setDraft((current) => ({ ...current, symbol: event.target.value }))
              }}
            >
              {symbolOptions(draft.symbol).map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-amount`}>amount</Label>
            <Input
              id={`${fieldId}-amount`}
              name="amount"
              value={draft.amount}
              disabled={isBusy}
              onChange={(event) => {
                setDraft((current) => ({ ...current, amount: event.target.value }))
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-recipient`}>recipientAddress</Label>
            <Input
              id={`${fieldId}-recipient`}
              name="recipientAddress"
              value={draft.recipientAddress}
              disabled={isBusy}
              className="font-mono"
              onChange={(event) => {
                setDraft((current) => ({ ...current, recipientAddress: event.target.value }))
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-status`}>status</Label>
            <select
              id={`${fieldId}-status`}
              name="status"
              value={draft.status}
              disabled={isBusy}
              className={cn(
                'flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none',
                'focus-ring disabled:cursor-not-allowed disabled:opacity-50',
              )}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as SendingStatus,
                }))
              }}
            >
              {SENDING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-failure`} className="text-destructive">
              failureMessage
            </Label>
            <Textarea
              id={`${fieldId}-failure`}
              name="failureMessage"
              value={draft.failureMessage ?? ''}
              disabled={isBusy}
              className="border-destructive/50 bg-destructive/10 text-destructive"
              onChange={(event) => {
                setDraft((current) => ({ ...current, failureMessage: event.target.value }))
              }}
            />
          </div>
          {error !== null ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </form>
      )}
    </Dialog>
  )
}

function ReadonlyField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-sm">{value}</p>
    </div>
  )
}

function symbolOptions(current: string): readonly string[] {
  const symbol = current.trim().toUpperCase()

  if (symbol === '' || (TOKEN_SYMBOLS as readonly string[]).includes(symbol)) {
    return TOKEN_SYMBOLS
  }

  return [symbol, ...TOKEN_SYMBOLS]
}

function emptyDraft(): IAdminSendingPatch {
  return {
    status: SENDING_STATUS.Pending,
    failureMessage: null,
    recipientAddress: '',
    amount: '',
    symbol: TOKEN_SYMBOL.ETH,
  }
}

function draftFromSending(sending: IRemoteSending): IAdminSendingPatch {
  return {
    status: sending.status ?? SENDING_STATUS.Pending,
    failureMessage: sending.failureMessage,
    recipientAddress: sending.recipientAddress ?? '',
    amount: sending.amount ?? '',
    symbol: sending.symbol ?? TOKEN_SYMBOL.ETH,
  }
}
