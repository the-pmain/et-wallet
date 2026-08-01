import { useState } from 'react'

import type { INetworkConfig } from '@/core'
import { ConfirmPassword, useSecurity } from '@/features/security'
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@/shared/ui'

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
              {isCancel ? 'Отмена транзакции' : 'Ускорение транзакции'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isCancel
                ? 'Кошелёк отправит перевод самому себе на нулевую сумму с тем же номером и большей комиссией. Если сеть примет его первым, исходная операция не состоится.'
                : 'Кошелёк повторит ту же операцию с тем же номером и большей комиссией. Сеть заменит прежнюю транзакцию новой.'}
            </p>
          </div>

          <dl className="flex flex-col gap-2 border-t pt-3 text-sm">
            <Row label="Номер (nonce)">{String(transaction.nonce)}</Row>
            <Row label="Получатель">{transaction.to ?? '—'}</Row>
            <Row label="Сумма">
              {formatTokenAmount(transaction.value, decimals)} {symbol}
            </Row>
            <Row label="Максимальная комиссия">
              {formatTokenAmount(maxFee, decimals)} {symbol}
            </Row>
            <Row label="Лимит газа">{transaction.gasLimit.toString()}</Row>
          </dl>

          <p className="text-xs text-muted-foreground">
            Комиссия исходной транзакции не возвращается только в одном случае: если в блок попадёт
            именно она. Невключённая транзакция не стоит ничего.
          </p>
        </CardContent>
      </Card>

      <Alert variant="warning">
        <AlertTitle>Успех не гарантирован</AlertTitle>
        <AlertDescription>
          {isCancel
            ? 'Исходная транзакция может попасть в блок раньше отменяющей — тогда перевод состоится, а отмена просто не будет принята. Следите за историей до тех пор, пока одна из них не подтвердится.'
            : 'Узлы принимают замену только при заметно большей комиссии и не обязаны это делать. Если замену отклонят, исходная транзакция останется в очереди.'}
        </AlertDescription>
      </Alert>

      {error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>{isCancel ? 'Отменить не удалось' : 'Ускорить не удалось'}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isConfirming ? (
        <ConfirmPassword
          action={isCancel ? 'отмену транзакции' : 'ускорение транзакции'}
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
            {isBusy ? 'Отправка…' : isCancel ? 'Отправить отмену' : 'Отправить ускорение'}
          </Button>

          <Button variant="ghost" className="sm:flex-1" disabled={isBusy} onClick={onCancel}>
            Ничего не делать
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
