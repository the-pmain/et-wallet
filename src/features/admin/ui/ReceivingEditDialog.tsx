import { useId, useState, type FormEvent } from 'react'

import type { IRemoteReceiving } from '@/features/onboarding'
import {
  SENDING_STATUS,
  SENDING_STATUSES,
  TOKEN_SYMBOLS,
  type SendingStatus,
} from '@/features/onboarding'
import { Button, Dialog, Input, Label, Select } from '@/shared/ui'

import { formatAdminTimestamp } from '../lib/format-admin-timestamp'
import type { IAdminReceivingPatch } from '../model/AdminClient'
import {
  FAILURE_MESSAGE_CUSTOM,
  FAILURE_MESSAGE_NONE,
  FAILURE_MESSAGE_PRESETS,
  failureMessageSelectValue,
  isCustomFailureMessage,
} from '../model/failure-messages'

interface ReceivingEditDialogProps {
  readonly receiving: IRemoteReceiving | null
  readonly isBusy: boolean
  readonly error: string | null
  readonly onClose: () => void
  readonly onSave: (id: string, patch: IAdminReceivingPatch) => void
}

export function ReceivingEditDialog({
  receiving,
  isBusy,
  error,
  onClose,
  onSave,
}: ReceivingEditDialogProps) {
  const fieldId = useId()
  const [draft, setDraft] = useState<IAdminReceivingPatch>(() =>
    receiving === null ? emptyDraft() : draftFromReceiving(receiving),
  )
  const [usesCustomMessage, setUsesCustomMessage] = useState(() =>
    isCustomFailureMessage(receiving?.failureMessage),
  )

  const isOpen = receiving !== null
  const isFailure = draft.status === SENDING_STATUS.Failure
  const hasFailureReason = (draft.failureMessage ?? '').trim() !== ''
  const canSave = !isBusy && (!isFailure || hasFailureReason)
  const failureSelectValue = usesCustomMessage
    ? FAILURE_MESSAGE_CUSTOM
    : failureMessageSelectValue(draft.failureMessage)

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()

    if (receiving === null || !canSave) {
      return
    }

    onSave(receiving.id, {
      status: draft.status,
      failureMessage: draft.failureMessage === '' ? null : draft.failureMessage,
      recipientAddress: draft.recipientAddress ?? null,
      amount: draft.amount.trim(),
      symbol: draft.symbol.trim(),
      usdAmount: draft.usdAmount ?? null,
    })
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit receiving"
      description="Change the asset, amount, status, or failure reason. ID, created time, and user stay as they are."
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
      {receiving === null ? null : (
        <form id={`${fieldId}-form`} className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="text-sm text-muted-foreground">
            id {receiving.id} · user {receiving.userId ?? '—'} ·{' '}
            {formatAdminTimestamp(receiving.createdAt)}
          </p>
          {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${fieldId}-symbol`}>Asset</Label>
              <Select
                id={`${fieldId}-symbol`}
                value={draft.symbol}
                disabled={isBusy}
                options={TOKEN_SYMBOLS.map((symbol) => ({ value: symbol, label: symbol }))}
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
          </div>
          <div className="flex flex-col gap-2">
            <Label
              htmlFor={`${fieldId}-status`}
              className={isFailure ? 'text-destructive' : undefined}
            >
              Status
            </Label>
            <Select
              id={`${fieldId}-status`}
              value={draft.status}
              disabled={isBusy}
              menuPlacement="top"
              tone={
                isFailure
                  ? 'danger'
                  : draft.status === SENDING_STATUS.Success
                    ? 'success'
                    : 'default'
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
            <Label
              htmlFor={`${fieldId}-failure`}
              className={isFailure ? 'text-destructive' : undefined}
            >
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
                { value: FAILURE_MESSAGE_CUSTOM, label: 'Custom' },
              ]}
              onChange={(value) => {
                if (value === FAILURE_MESSAGE_CUSTOM) {
                  setUsesCustomMessage(true)
                  return
                }

                setUsesCustomMessage(false)
                setDraft((current) => ({
                  ...current,
                  failureMessage: value === FAILURE_MESSAGE_NONE ? '' : value,
                }))
              }}
            />
          </div>
        </form>
      )}
    </Dialog>
  )
}

function emptyDraft(): IAdminReceivingPatch {
  return {
    status: SENDING_STATUS.Pending,
    failureMessage: null,
    recipientAddress: null,
    amount: '',
    symbol: TOKEN_SYMBOLS[0] ?? 'ETH',
    usdAmount: null,
  }
}

function draftFromReceiving(receiving: IRemoteReceiving): IAdminReceivingPatch {
  return {
    status: receiving.status ?? SENDING_STATUS.Pending,
    failureMessage: receiving.failureMessage,
    recipientAddress: receiving.recipientAddress,
    amount: receiving.amount ?? '',
    symbol: receiving.symbol ?? TOKEN_SYMBOLS[0] ?? 'ETH',
    usdAmount: receiving.usdAmount,
  }
}
