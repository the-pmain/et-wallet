import { useState } from 'react'

import type { INetworkConfig } from '@/core'
import { ConfirmPassword, useSecurity } from '@/features/security'
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@/shared/ui'

import { PreflightNotice } from './PreflightNotice'

import { formatTokenAmount } from '../lib/format'
import { REPLACEMENT_KIND, type ReplacementKind } from '../lib/replacement'
import type { IPreparedTransfer } from '../model/contracts'

interface ReplaceTransactionCardProps {
  readonly kind: ReplacementKind
  readonly prepared: IPreparedTransfer
  readonly network: INetworkConfig | null

  readonly isBusy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Подтверждение замены зависшей транзакции.
 *
 * ПОКАЗЫВАЮТСЯ ПОЛЯ ПОДПИСЫВАЕМОГО ОБЪЕКТА, как и на обычной отправке:
 * замена — полноценная транзакция, и пересчитывать её значения для показа
 * значило бы разойтись с тем, что уходит в сеть.
 *
 * НОМЕР ВЫНЕСЕН НА ВИДНОЕ МЕСТО. Совпадение номера с исходной транзакцией —
 * это и есть механизм замены, и по нему пользователь может убедиться, что
 * отправляет замену, а не вторую транзакцию вдобавок к застрявшей.
 *
 * ОТСУТСТВИЕ ГАРАНТИИ НАЗЫВАЕТСЯ ПРЯМО. Обещание «перевод отменён» там,
 * где отмена лишь вероятна, хуже отсутствия функции: человек перестанет
 * следить за исходом.
 */
export function ReplaceTransactionCard({
  kind,
  prepared,
  network,
  isBusy,
  error,
  onConfirm,
  onCancel,
}: ReplaceTransactionCardProps) {
  const { settings, verifyPassword } = useSecurity()
  const [isConfirming, setConfirming] = useState(false)

  const { transaction } = prepared
  const isCancel = kind === REPLACEMENT_KIND.Cancel

  const decimals = network?.nativeCurrency.decimals ?? 18
  const symbol = network?.nativeCurrency.symbol ?? ''
  const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
  const maxFee = transaction.gasLimit * feePerGas

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">
              {isCancel ? 'Cancelling a transaction' : 'Speeding up a transaction'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isCancel
                ? 'The wallet will send a zero-value transfer to yourself with the same nonce and a higher fee. If the network accepts it first, the original operation will not happen.'
                : 'The wallet will repeat the same operation with the same nonce and a higher fee. The network will replace the previous transaction with the new one.'}
            </p>
          </div>

          <dl className="flex flex-col gap-2 border-t pt-3 text-sm">
            <Row label="Nonce">{String(transaction.nonce)}</Row>
            <Row label="Recipient">{transaction.to ?? '—'}</Row>
            <Row label="Amount">
              {formatTokenAmount(transaction.value, decimals)} {symbol}
            </Row>
            <Row label="Maximum fee">
              {formatTokenAmount(maxFee, decimals)} {symbol}
            </Row>
            <Row label="Gas limit">{transaction.gasLimit.toString()}</Row>
          </dl>

          <p className="text-xs text-muted-foreground">
            The fee of the original transaction is lost only in one case: if that transaction is the
            one that lands in a block. A transaction that is never included costs nothing.
          </p>
        </CardContent>
      </Card>

      <PreflightNotice preflight={prepared.preflight} />

      <Alert variant="warning">
        <AlertTitle>Success is not guaranteed</AlertTitle>
        <AlertDescription>
          {isCancel
            ? 'The original transaction may land in a block before the cancelling one — then the transfer happens and the cancellation is simply not accepted. Watch the history until one of them is confirmed.'
            : 'Nodes accept a replacement only when the fee is noticeably higher, and they are not obliged to. If the replacement is rejected, the original transaction stays in the queue.'}
        </AlertDescription>
      </Alert>

      {error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>{isCancel ? 'Cancelling failed' : 'Speeding up failed'}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isConfirming ? (
        <ConfirmPassword
          action={isCancel ? 'cancelling the transaction' : 'speeding up the transaction'}
          onVerify={verifyPassword}
          onConfirmed={() => {
            setConfirming(false)
            onConfirm()
          }}
          onCancel={() => {
            setConfirming(false)
          }}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="sm:flex-1"
            disabled={isBusy}
            onClick={() => {
              if (settings.confirmBeforeSigning) {
                setConfirming(true)

                return
              }

              onConfirm()
            }}
          >
            {isBusy ? 'Sending…' : isCancel ? 'Send the cancellation' : 'Send the speed-up'}
          </Button>

          <Button variant="ghost" className="sm:flex-1" disabled={isBusy} onClick={onCancel}>
            Do nothing
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono text-xs tabular-nums">{children}</dd>
    </div>
  )
}
