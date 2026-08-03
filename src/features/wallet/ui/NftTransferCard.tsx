import { useId, useState } from 'react'

import { TOKEN_STANDARD, decodeSafeTransferRecipient, type INftItem, type TxHash } from '@/core'
import { ConfirmPassword, useSecurity } from '@/features/security'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from '@/shared/ui'

import { formatTokenAmount, shortenAddress } from '../lib/format'
import type { IPreparedTransfer } from '../model/contracts'
import { useWallet, useWalletSnapshot } from '../model/wallet-context'

interface NftTransferCardProps {
  readonly item: INftItem

  /** Закрывает форму, ничего не отправив. */
  readonly onCancel: () => void

  /** Вызывается после успешной отправки. */
  readonly onSent: (hash: TxHash) => void
}

/**
 * Передача коллекционного предмета.
 *
 * ЦЕНА ОШИБКИ ЗДЕСЬ ВЫШЕ, ЧЕМ У ПЕРЕВОДА ДЕНЕГ. Предмет существует
 * в одном экземпляре: отправленный не туда, он не возвращается
 * и не покупается заново. Поэтому получатель показывается целиком
 * и берётся из данных подписываемой транзакции, а не из поля формы.
 *
 * ТРАНЗАКЦИЯ АДРЕСОВАНА КОНТРАКТУ, а не получателю: передачу выполняет
 * контракт коллекции. Экран называет оба адреса — иначе человек,
 * сверяющий их, решит, что кошелёк подменил получателя.
 */
export function NftTransferCard({ item, onCancel, onSent }: NftTransferCardProps) {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const { settings, verifyPassword } = useSecurity()
  const fieldId = useId()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('1')
  const [prepared, setPrepared] = useState<IPreparedTransfer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)
  const [isConfirming, setConfirming] = useState(false)

  const network = snapshot.activeNetwork
  const account = snapshot.activeAccount
  const isMultiple = item.standard === TOKEN_STANDARD.Erc1155

  const decimals = network?.nativeCurrency.decimals ?? 18
  const symbol = network?.nativeCurrency.symbol ?? ''

  async function prepare(): Promise<void> {
    if (account === null || network === null) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const resolution = await session.resolveRecipient(recipient.trim())

      if (resolution.address === null) {
        setError('The recipient was not resolved: enter an address or an ENS name that exists.')

        return
      }

      setPrepared(
        await session.prepareNftTransfer({
          chainId: item.chainId,
          from: account.address,
          contract: item.contract,
          to: resolution.address,
          tokenId: item.tokenId,
          standard: item.standard,
          ...(isMultiple ? { amount: BigInt(amount) } : {}),
        }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function send(): Promise<void> {
    if (prepared === null) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      onSent(await session.sendTransfer(prepared.transaction))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (prepared !== null) {
    const { transaction } = prepared
    const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
    const maxFee = transaction.gasLimit * feePerGas

    /* Получатель читается из подписываемых данных: показанное совпадает
       с подписываемым по устройству экрана, а не по внимательности. */
    const confirmedRecipient = decodeSafeTransferRecipient(transaction.data)

    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h2 className="text-base font-semibold">Confirm the transfer</h2>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Item</span>
              <span className="text-sm">
                {item.collectionName ?? 'Collection without a name'} · #{item.tokenId.toString()}
                {isMultiple ? ` · ${amount} pcs` : ''}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Recipient</span>
              <span className="font-mono text-sm break-all">{confirmedRecipient ?? '—'}</span>
            </div>

            <div className="flex flex-col gap-1.5 rounded-xl border p-3">
              <span className="text-xs text-muted-foreground">
                The transaction will be sent to the collection contract
              </span>
              <span className="font-mono text-sm break-all">{transaction.to ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                This is how an item transfer works: the contract reassigns it to the recipient
                address. Zero currency is transferred — only the fee is charged.
              </span>
            </div>

            <dl className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Maximum fee</dt>
                <dd className="text-right font-mono text-xs tabular-nums">
                  {formatTokenAmount(maxFee, decimals)} {symbol}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Alert variant="danger">
          <AlertTitle>The transfer cannot be undone</AlertTitle>
          <AlertDescription>
            The item exists in a single copy. Sent to the wrong address, it comes back neither
            through the wallet nor through support. Check the recipient address character by
            character.
          </AlertDescription>
        </Alert>

        {error === null ? null : (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isConfirming ? (
          <ConfirmPassword
            action="transferring the item"
            onVerify={verifyPassword}
            onConfirmed={() => {
              setConfirming(false)
              void send()
            }}
            onCancel={() => {
              setConfirming(false)
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              className="sm:flex-1"
              variant="destructive"
              disabled={isBusy}
              onClick={() => {
                if (settings.confirmBeforeSigning) {
                  setConfirming(true)

                  return
                }

                void send()
              }}
            >
              {isBusy ? 'Sending…' : 'Transfer the item'}
            </Button>

            <Button
              variant="ghost"
              className="sm:flex-1"
              disabled={isBusy}
              onClick={() => {
                setPrepared(null)
              }}
            >
              Back
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Transfer the item</h2>
          <p className="text-xs text-muted-foreground">
            {item.collectionName ?? 'Collection without a name'} · #{item.tokenId.toString()} ·{' '}
            {shortenAddress(item.contract)}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-to`}>Recipient address or ENS name</Label>
          <Input
            id={`${fieldId}-to`}
            value={recipient}
            placeholder="0x… or name.eth"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setRecipient(event.target.value)
              setError(null)
            }}
          />
        </div>

        {isMultiple ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-amount`}>How many copies</Label>
            <Input
              id={`${fieldId}-amount`}
              value={amount}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => {
                setAmount(event.target.value)
                setError(null)
              }}
            />
            <p className="text-xs text-muted-foreground">
              You own {item.balance.toString()} of this item.
            </p>
          </div>
        ) : null}

        {error === null ? null : (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="sm:flex-1"
            disabled={isBusy || recipient.trim() === ''}
            onClick={() => void prepare()}
          >
            {isBusy ? 'Estimating the fee…' : 'Next'}
          </Button>

          <Button variant="ghost" className="sm:flex-1" disabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
