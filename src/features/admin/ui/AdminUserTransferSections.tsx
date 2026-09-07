import { useId, useMemo, useState } from 'react'

import {
  SENDING_STATUS,
  SENDING_STATUSES,
  type IRemoteUser,
  type IUserWalletsMap,
  type SendingStatus,
} from '@/features/onboarding'
import { useRemoteAssetQuotes } from '@/features/onboarding/model/use-remote-asset-quotes'
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@/shared/ui'

import {
  quotePriceUsd,
  usdAmountFromCryptoInput,
  usdEquivalentFromCryptoAmount,
} from '../lib/asset-usd-input'
import { AdminAuthError } from '../model/AdminClient'
import { useAdminSession } from '../model/admin-context'

import { MOCK_WALLET_ADDRESS, MOCK_WALLET_CODENAME } from './admin-wallets'
import { defaultTransferAsset, TransferAssetSelect } from './TransferAssetSelect'

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/u

/**
 * Create sendings and receivings for this user. Forms only — lists live
 * on the owner's Activity page.
 */
export function AdminUserTransferSections({
  user,
  onUserUpdated,
}: {
  readonly user: IRemoteUser
  readonly onUserUpdated: (user: IRemoteUser) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <UserSendingsSection user={user} onUserUpdated={onUserUpdated} />
      <UserReceivingsSection user={user} onUserUpdated={onUserUpdated} />
    </div>
  )
}

function UserSendingsSection({
  user,
  onUserUpdated,
}: {
  readonly user: IRemoteUser
  readonly onUserUpdated: (user: IRemoteUser) => void
}) {
  const { client, lock } = useAdminSession()
  const formId = useId()
  const [asset, setAsset] = useState(defaultTransferAsset)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [status, setStatus] = useState<SendingStatus>(SENDING_STATUS.Pending)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function createSending(): Promise<void> {
    const recipientAddress = recipient.trim()
    const trimmedAmount = amount.trim()

    if (!ADDRESS_SHAPE.test(recipientAddress)) {
      setError('Recipient must be a valid EVM address.')
      setMessage(null)
      return
    }

    if (trimmedAmount === '' || !/^\d+(\.\d+)?$/u.test(trimmedAmount)) {
      setError('Amount must be a number.')
      setMessage(null)
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      await client.createSending({
        userId: user.id,
        recipientAddress,
        amount: trimmedAmount,
        symbol: asset.token.symbol,
        status,
        failureMessage: status === SENDING_STATUS.Failure ? 'Rejected by admin' : null,
      })
      setAmount('')
      setRecipient('')
      setStatus(SENDING_STATUS.Pending)
      setMessage(`Sending created (${status}).`)

      if (status === SENDING_STATUS.Success) {
        onUserUpdated(await client.getUser(user.id))
      }
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()
        return
      }

      setError('The sending could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sendings</CardTitle>
        <p className="text-sm text-muted-foreground">
          Create a transfer for this user. It appears on their Activity page.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-symbol`}>Sending asset</Label>
            <TransferAssetSelect
              id={`${formId}-symbol`}
              value={asset.id}
              disabled={busy}
              onChange={setAsset}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-amount`}>Sending amount</Label>
            <Input
              id={`${formId}-amount`}
              value={amount}
              inputMode="decimal"
              placeholder="0.01"
              disabled={busy}
              onChange={(event) => {
                setAmount(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`${formId}-recipient`}>Recipient</Label>
            <Input
              id={`${formId}-recipient`}
              value={recipient}
              className="font-mono"
              placeholder="0x…"
              disabled={busy}
              onChange={(event) => {
                setRecipient(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-status`}>Sending status</Label>
            <Select
              id={`${formId}-status`}
              value={status}
              disabled={busy}
              options={SENDING_STATUSES.map((item) => ({ value: item, label: item }))}
              onChange={(value) => {
                setStatus(value as SendingStatus)
              }}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={busy} onClick={() => void createSending()}>
              {busy ? 'Creating…' : 'Create sending'}
            </Button>
          </div>
        </div>
        {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
        {message === null ? null : <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  )
}

function UserReceivingsSection({
  user,
  onUserUpdated,
}: {
  readonly user: IRemoteUser
  readonly onUserUpdated: (user: IRemoteUser) => void
}) {
  const { client, lock } = useAdminSession()
  const formId = useId()
  const walletOptions = useMemo(() => walletChoices(user.wallets), [user.wallets])
  const [asset, setAsset] = useState(defaultTransferAsset)
  const [amount, setAmount] = useState('')
  const [walletCodename, setWalletCodename] = useState(walletOptions[0]?.value ?? MOCK_WALLET_CODENAME)
  const { quotes } = useRemoteAssetQuotes([asset.token])
  const priceUsd = quotePriceUsd(asset.token, quotes)
  const usdEquivalent = usdEquivalentFromCryptoAmount(amount, priceUsd)
  const [status, setStatus] = useState<SendingStatus>(SENDING_STATUS.Pending)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function createReceiving(): Promise<void> {
    const trimmedAmount = amount.trim()

    if (trimmedAmount === '' || !/^\d+(\.\d+)?$/u.test(trimmedAmount)) {
      setError('Amount must be a number.')
      setMessage(null)
      return
    }

    const selected =
      walletOptions.find((item) => item.value === walletCodename) ?? walletOptions[0] ?? mockWalletChoice()

    setBusy(true)
    setError(null)
    setMessage(null)

    try {
      await client.createReceiving({
        userId: user.id,
        amount: trimmedAmount,
        symbol: asset.token.symbol,
        usdAmount: usdAmountFromCryptoInput(trimmedAmount, priceUsd),
        status,
        failureMessage: status === SENDING_STATUS.Failure ? 'Rejected by admin' : null,
        recipientAddress: selected.address,
      })
      setAmount('')
      setStatus(SENDING_STATUS.Pending)
      setMessage(`Receiving created (${status}).`)

      if (status === SENDING_STATUS.Success) {
        onUserUpdated(await client.getUser(user.id))
      }
    } catch (caught: unknown) {
      if (caught instanceof AdminAuthError && caught.status === 401) {
        lock()
        return
      }

      setError('The receiving could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receivings</CardTitle>
        <p className="text-sm text-muted-foreground">
          Deposit any amount of any ticker. Pick a wallet or use the default mock wallet. The
          record appears on the owner&apos;s Activity page.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-symbol`}>Receiving asset</Label>
            <TransferAssetSelect
              id={`${formId}-symbol`}
              value={asset.id}
              disabled={busy}
              onChange={setAsset}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-amount`}>Receiving amount</Label>
            <Input
              id={`${formId}-amount`}
              value={amount}
              inputMode="decimal"
              placeholder="0.20"
              disabled={busy}
              onChange={(event) => {
                setAmount(event.target.value)
              }}
            />
            {usdEquivalent === null ? null : (
              <p className="text-xs text-muted-foreground tabular-nums">{usdEquivalent}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-wallet`}>Wallet</Label>
            <Select
              id={`${formId}-wallet`}
              value={walletCodename}
              disabled={busy}
              options={walletOptions.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              onChange={setWalletCodename}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-status`}>Receiving status</Label>
            <Select
              id={`${formId}-status`}
              value={status}
              disabled={busy}
              options={SENDING_STATUSES.map((item) => ({ value: item, label: item }))}
              onChange={(value) => {
                setStatus(value as SendingStatus)
              }}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={busy} onClick={() => void createReceiving()}>
              {busy ? 'Creating…' : 'Create receiving'}
            </Button>
          </div>
        </div>
        {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
        {message === null ? null : <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  )
}

function walletChoices(wallets: IUserWalletsMap): readonly {
  readonly value: string
  readonly label: string
  readonly address: string
}[] {
  const entries = Object.entries(wallets)

  if (entries.length === 0) {
    return [mockWalletChoice()]
  }

  return entries.map(([codename, slot]) => ({
    value: codename,
    label: `${codename} · ${shortAddress(slot.key)}`,
    address: slot.key,
  }))
}

function mockWalletChoice(): {
  readonly value: string
  readonly label: string
  readonly address: string
} {
  return {
    value: MOCK_WALLET_CODENAME,
    label: `${MOCK_WALLET_CODENAME} · ${shortAddress(MOCK_WALLET_ADDRESS)}`,
    address: MOCK_WALLET_ADDRESS,
  }
}

function shortAddress(address: string): string {
  if (address.length < 12) {
    return address
  }

  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
