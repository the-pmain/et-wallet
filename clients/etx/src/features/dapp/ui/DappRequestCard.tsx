import { AlertTriangle, FileSignature, Globe, ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { DAPP_REQUEST_KIND, DAPP_RISK, type DappRisk, type IDappRequest } from '@/core'
import { ConfirmPassword, UntrustedText, useSecurity } from '@/features/security'
import { PreflightNotice } from '@/features/wallet'
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent } from '@/shared/ui'

import type { IPendingRequest } from '../model/DappSessionService'

interface DappRequestCardProps {
  readonly pending: IPendingRequest
  readonly isBusy: boolean
  readonly onApprove: () => void
  readonly onReject: () => void
}

/**
 * Запрос приложения, ожидающий решения.
 *
 * ПОКАЗЫВАЕТСЯ СОДЕРЖИМОЕ, А НЕ ХЭШ. Хэш структуры не говорит
 * пользователю ничего, и он нажимает «подписать», потому что иначе
 * приложение не работает. Именно так отдают неограниченное разрешение
 * на токены, не увидев ни списания, ни комиссии.
 *
 * ЗАМЕЧАНИЯ ИДУТ ПЕРЕД СОДЕРЖИМЫМ, А НЕ ПОСЛЕ. Предупреждение под
 * длинной структурой не читает никто.
 *
 * ИМЯ И АДРЕС ПРИЛОЖЕНИЯ — ЗАЯВЛЕНИЕ СТОРОНЫ, А НЕ ФАКТ. Назваться
 * известным приложением может кто угодно, поэтому они показаны как
 * присланные значения и обезврежены от скрытых символов.
 *
 * ПАРОЛЬ СПРАШИВАЕТСЯ ПО ТОЙ ЖЕ НАСТРОЙКЕ, ЧТО И ПРИ ОТПРАВКЕ ИЗ
 * КОШЕЛЬКА. Раньше не спрашивался вовсе, и это было хуже всего:
 * удалённый запрос приходит от постороннего приложения, а собственная
 * отправка — от владельца за устройством. Требовать подтверждение
 * у второго и не требовать у первого значит защищать слабее там,
 * где опаснее.
 */
export function DappRequestCard({ pending, isBusy, onApprove, onReject }: DappRequestCardProps) {
  const { request, risks, preflight } = pending
  const { settings, verifyPassword } = useSecurity()
  const [isConfirming, setConfirming] = useState(false)

  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="icon-tile size-10 shrink-0 rounded-xl">
            <FileSignature className="size-5" aria-hidden />
          </span>

          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">
              <UntrustedText
                value={request.dapp.name === '' ? 'Application without a name' : request.dapp.name}
              />
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              <UntrustedText
                value={request.dapp.url === '' ? 'no address given' : request.dapp.url}
              />
            </span>
          </div>

          <Badge variant="outline" className="ml-auto shrink-0">
            {describeKind(request.payload.kind)}
          </Badge>
        </div>

        {risks.map((finding) => (
          <RiskAlert key={finding.risk} risk={finding.risk} detail={finding.detail} />
        ))}

        <RequestBody request={request} />

        {/* ИТОГ ПРОГОНА ИДЁТ ПОСЛЕ СОДЕРЖИМОГО И ЗАМЕЧАНИЙ. Он отвечает
            на вопрос «состоится ли вызов», тогда как выше сказано, что
            именно подписывается, — и это важнее.

            Пока узла нет ответа, здесь не показывается ничего:
            крутящееся ожидание рядом с кнопкой «подтвердить» торопит
            нажать, не дождавшись. */}
        {preflight === null ? null : <PreflightNotice preflight={preflight} />}

        <Alert variant="warning">
          <AlertDescription>
            A signature cannot be revoked. Make sure you understand what the application is asking
            for: signatures are presented to a contract later and never appear in the wallet
            history.
          </AlertDescription>
        </Alert>

        {/* Повторный ввод пароля защищает от того, кто получил доступ
            к уже разблокированному кошельку, и от приложения, которое
            дождалось разблокировки. Настройка одна с отправкой:
            два переключателя означали бы, что владелец защитил один
            путь и не заметил второго. */}
        {isConfirming ? (
          <ConfirmPassword
            action="signing on behalf of an application"
            onVerify={verifyPassword}
            onConfirmed={() => {
              setConfirming(false)
              onApprove()
            }}
            onCancel={() => {
              setConfirming(false)
            }}
          />
        ) : (
          <div className="flex gap-2">
            <Button variant="default" className="flex-1" disabled={isBusy} onClick={onReject}>
              Reject
            </Button>

            <Button
              variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
              disabled={isBusy}
              onClick={() => {
                if (settings.confirmBeforeSigning) {
                  setConfirming(true)

                  return
                }

                onApprove()
              }}
            >
              {isBusy ? 'Working…' : 'Confirm'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Человекочитаемое название запрошенного действия. */
function describeKind(kind: IDappRequest['payload']['kind']): string {
  switch (kind) {
    case DAPP_REQUEST_KIND.SignMessage:
      return 'Message signature'
    case DAPP_REQUEST_KIND.SignTypedData:
      return 'Typed data signature'
    case DAPP_REQUEST_KIND.SendTransaction:
      return 'Sending a transaction'
    case DAPP_REQUEST_KIND.SignTransaction:
      return 'Transaction signature'
  }
}

/** Содержимое запроса в разобранном виде. */
function RequestBody({ request }: { readonly request: IDappRequest }) {
  const payload = request.payload

  if (payload.kind === DAPP_REQUEST_KIND.SignMessage) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Message</span>
        <pre className="max-h-48 overflow-auto rounded-xl border p-3 text-xs break-words whitespace-pre-wrap">
          {payload.message}
        </pre>
      </div>
    )
  }

  if (payload.kind === DAPP_REQUEST_KIND.SignTypedData) {
    const { domain, primaryType, message } = payload.typedData

    return (
      <div className="flex flex-col gap-2">
        <Row label="Type">{primaryType}</Row>
        {domain.name === undefined ? null : <Row label="Domain">{domain.name}</Row>}
        {domain.verifyingContract === undefined ? null : (
          <Row label="Contract">{domain.verifyingContract}</Row>
        )}
        <Row label="Network">{request.chainId.toString()}</Row>

        <span className="text-xs text-muted-foreground">Structure fields</span>
        <pre className="max-h-48 overflow-auto rounded-xl border p-3 text-xs break-words whitespace-pre-wrap">
          {formatMessage(message)}
        </pre>
      </div>
    )
  }

  const { transaction } = payload

  return (
    <div className="flex flex-col gap-2">
      <Row label="Recipient">{transaction.to ?? 'contract creation'}</Row>
      <Row label="Sender">{transaction.from}</Row>
      <Row label="Amount">{transaction.value.toString()}</Row>
      <Row label="Network">{request.chainId.toString()}</Row>

      {transaction.data === null || transaction.data === '0x' ? null : (
        <>
          <span className="text-xs text-muted-foreground">Call data</span>
          <pre className="max-h-32 overflow-auto rounded-xl border p-3 text-xs break-all">
            {transaction.data}
          </pre>
        </>
      )}
    </div>
  )
}

/**
 * Готовит поля структуры к показу.
 *
 * `JSON.stringify` не умеет больших целых и падает на них, а значения
 * разрешений приходят именно такими.
 */
function formatMessage(message: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    message,
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs break-all">{children}</span>
    </div>
  )
}

/** Предупреждение по одному замечанию. */
function RiskAlert({ risk, detail }: { readonly risk: DappRisk; readonly detail: string | null }) {
  const text = RISK_TEXT[risk]

  return (
    <Alert variant={text.isCritical ? 'danger' : 'warning'}>
      {text.isCritical ? <ShieldAlert /> : <AlertTriangle />}
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>
        {text.description}
        {detail === null ? null : <> ({detail})</>}
      </AlertDescription>
    </Alert>
  )
}

/** Пояснения к замечаниям. */
const RISK_TEXT: Readonly<
  Record<DappRisk, { title: string; description: string; isCritical: boolean }>
> = {
  [DAPP_RISK.TokenPermit]: {
    title: 'This signature hands over control of your tokens',
    description:
      'This is not a transfer: nothing is charged and no fee is paid. The signature lets the named address take your tokens later, and it can only be undone by revoking the approval.',
    isCritical: true,
  },
  [DAPP_RISK.UnlimitedAllowance]: {
    title: 'The approved amount is unlimited',
    description:
      'The recipient will be able to take every token of this kind — now and at any point in the future.',
    isCritical: true,
  },
  [DAPP_RISK.ApprovalCall]: {
    title: 'This transaction grants an approval',
    description: 'After it, the named address may dispose of your tokens without asking again.',
    isCritical: true,
  },
  [DAPP_RISK.ChainMismatch]: {
    title: 'A different network is requested',
    description:
      'The application asks for an action in a network other than the one selected in the wallet. A signature made in the wrong network may turn out to be valid where you do not expect it.',
    isCritical: false,
  },
  [DAPP_RISK.MissingVerifyingContract]: {
    title: 'The verifying contract is not specified',
    description: 'There is no way to tell which contract the signature is meant for.',
    isCritical: false,
  },
  [DAPP_RISK.MessageLooksLikeTransaction]: {
    title: 'The message is unreadable',
    description:
      'A hexadecimal string was sent instead of text. There is no way to tell what is being signed from it.',
    isCritical: false,
  },
  [DAPP_RISK.UnreadableMessage]: {
    title: 'The message contains hidden characters',
    description: 'Part of the text may be invisible on screen.',
    isCritical: false,
  },
  [DAPP_RISK.BurnRecipient]: {
    title: 'The recipient is a burn address',
    description: 'Funds sent there will never reach anyone.',
    isCritical: true,
  },
  [DAPP_RISK.ContractDeployment]: {
    title: 'A contract is being deployed',
    description: 'The transaction has no recipient: it creates a new contract in the network.',
    isCritical: false,
  },
  [DAPP_RISK.OpaqueCallData]: {
    title: 'The meaning of the call was not recognised',
    description:
      'The wallet could not work out what this transaction does. Confirm it only if you understand what the application is asking for.',
    isCritical: false,
  },
}
