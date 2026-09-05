import { useId, useState, type FormEvent } from 'react'

import type { IRemoteSending } from '@/features/onboarding'
import {
  SENDING_STATUS,
  SENDING_STATUSES,
  TOKEN_SYMBOL,
  TOKEN_SYMBOLS,
  type SendingStatus,
} from '@/features/onboarding'
import { Button, Dialog, Input, Label, Select, Textarea } from '@/shared/ui'

import { formatAdminTimestamp } from '../lib/format-admin-timestamp'
import type { IAdminSendingPatch } from '../model/AdminClient'
import {
  FAILURE_MESSAGE_CUSTOM,
  FAILURE_MESSAGE_NONE,
  FAILURE_MESSAGE_PRESETS,
  failureMessageSelectValue,
  isCustomFailureMessage,
} from '../model/failure-messages'

interface SendingEditDialogProps {
  readonly sending: IRemoteSending | null
  readonly isBusy: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onSave: (id: string, patch: IAdminSendingPatch) => void
}

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
  const [usesCustomMessage, setUsesCustomMessage] = useState(() =>
    isCustomFailureMessage(sending?.failureMessage),
  )

  const isOpen = sending !== null
  const isFailure = draft.status === SENDING_STATUS.Failure
  const hasFailureReason = (draft.failureMessage ?? '').trim() !== ''
  const canSave = !isBusy && (!isFailure || hasFailureReason)
  const failureSelectValue = usesCustomMessage
    ? FAILURE_MESSAGE_CUSTOM
    : failureMessageSelectValue(draft.failureMessage)

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()

    if (sending === null || !canSave) {
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
      description="Change the asset, amount, recipient, status, or failure reason. ID, created time, and user stay as they are."
      footer={
        <>
          <Button type="button" variant="ghost" disabled={isBusy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${fieldId}-form`} disabled={!canSave}>
            {isBusy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {sending === null ? null : (
        <form id={`${fieldId}-form`} className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <ReadonlyField label="ID" value={sending.id} />
          <ReadonlyField label="Created" value={formatAdminTimestamp(sending.createdAt)} />
          <ReadonlyField label="User" value={sending.userId ?? '—'} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-symbol`}>Asset</Label>
            <Select
              id={`${fieldId}-symbol`}
              value={draft.symbol}
              disabled={isBusy}
              options={symbolOptions(draft.symbol).map((symbol) => ({
                value: symbol,
                label: symbol,
              }))}
              onChange={(symbol) => {
                setDraft((current) => ({ ...current, symbol }))
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-amount`}>Amount</Label>
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
            <Label htmlFor={`${fieldId}-recipient`}>Recipient</Label>
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
            <Label htmlFor={`${fieldId}-status`} className={isFailure ? 'text-destructive' : undefined}>
              Status
            </Label>
            <Select
              id={`${fieldId}-status`}
              value={draft.status}
              disabled={isBusy}
              menuPlacement="top"
              tone={
                isFailure ? 'danger' : draft.status === SENDING_STATUS.Success ? 'success' : 'default'
              }
              options={SENDING_STATUSES.map((status) => ({
                value: status,
                label: status,
              }))}
              onChange={(status) => {
                setDraft((current) => ({
                  ...current,
                  status: status as SendingStatus,
                }))
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-failure`} className={isFailure ? 'text-destructive' : undefined}>
              Failure reason
            </Label>
            <Select
              id={`${fieldId}-failure`}
              value={failureSelectValue}
              disabled={isBusy || !isFailure}
              tone={isFailure ? 'danger' : 'default'}
              menuPlacement="top"
              options={[
                { value: FAILURE_MESSAGE_NONE, label: 'None' },
                ...FAILURE_MESSAGE_PRESETS.map((message) => ({
                  value: message,
                  label: message,
                })),
                { value: FAILURE_MESSAGE_CUSTOM, label: 'Custom…' },
              ]}
              onChange={(next) => {
                if (next === FAILURE_MESSAGE_CUSTOM) {
                  setUsesCustomMessage(true)
                  setDraft((current) => ({
                    ...current,
                    failureMessage: isCustomFailureMessage(current.failureMessage)
                      ? current.failureMessage
                      : '',
                  }))
                  return
                }

                setUsesCustomMessage(false)
                setDraft((current) => ({
                  ...current,
                  failureMessage: next === FAILURE_MESSAGE_NONE ? null : next,
                }))
              }}
            />
            {usesCustomMessage && isFailure ? (
              <Textarea
                id={`${fieldId}-failure-custom`}
                name="failureMessageCustom"
                aria-label="Custom failure message"
                value={draft.failureMessage ?? ''}
                disabled={isBusy}
                placeholder="Write the failure reason"
                className="border-destructive/50 bg-destructive/10 text-destructive"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, failureMessage: event.target.value }))
                }}
              />
            ) : null}
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
