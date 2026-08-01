import { AlertTriangle, FileSignature, Globe, ShieldAlert } from 'lucide-react'

import { DAPP_REQUEST_KIND, DAPP_RISK, type DappRisk, type IDappRequest } from '@/core'
import { UntrustedText } from '@/features/security'
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
 */
export function DappRequestCard({ pending, isBusy, onApprove, onReject }: DappRequestCardProps) {
  const { request, risks } = pending

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
                value={request.dapp.name === '' ? 'Приложение без имени' : request.dapp.name}
              />
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="size-3 shrink-0" aria-hidden />
              <UntrustedText
                value={request.dapp.url === '' ? 'адрес не указан' : request.dapp.url}
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

        <Alert variant="warning">
          <AlertDescription>
            Подпись отозвать невозможно. Проверьте, что понимаете, о чём просит приложение: подписи
            предъявляются контракту позже и в истории операций кошелька не отражаются.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Button variant="default" className="flex-1" disabled={isBusy} onClick={onReject}>
            Отклонить
          </Button>

          <Button
            variant="outline"
            className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
            disabled={isBusy}
            onClick={onApprove}
          >
            {isBusy ? 'Выполняем…' : 'Подтвердить'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Человекочитаемое название запрошенного действия. */
function describeKind(kind: IDappRequest['payload']['kind']): string {
  switch (kind) {
    case DAPP_REQUEST_KIND.SignMessage:
      return 'Подпись сообщения'
    case DAPP_REQUEST_KIND.SignTypedData:
      return 'Подпись структуры'
    case DAPP_REQUEST_KIND.SendTransaction:
      return 'Отправка транзакции'
    case DAPP_REQUEST_KIND.SignTransaction:
      return 'Подпись транзакции'
  }
}

/** Содержимое запроса в разобранном виде. */
function RequestBody({ request }: { readonly request: IDappRequest }) {
  const payload = request.payload

  if (payload.kind === DAPP_REQUEST_KIND.SignMessage) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Сообщение</span>
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
        <Row label="Тип">{primaryType}</Row>
        {domain.name === undefined ? null : <Row label="Домен">{domain.name}</Row>}
        {domain.verifyingContract === undefined ? null : (
          <Row label="Контракт">{domain.verifyingContract}</Row>
        )}
        <Row label="Сеть">{request.chainId.toString()}</Row>

        <span className="text-xs text-muted-foreground">Поля структуры</span>
        <pre className="max-h-48 overflow-auto rounded-xl border p-3 text-xs break-words whitespace-pre-wrap">
          {formatMessage(message)}
        </pre>
      </div>
    )
  }

  const { transaction } = payload

  return (
    <div className="flex flex-col gap-2">
      <Row label="Получатель">{transaction.to ?? 'создание контракта'}</Row>
      <Row label="Отправитель">{transaction.from}</Row>
      <Row label="Сумма">{transaction.value.toString()}</Row>
      <Row label="Сеть">{request.chainId.toString()}</Row>

      {transaction.data === null || transaction.data === '0x' ? null : (
        <>
          <span className="text-xs text-muted-foreground">Данные вызова</span>
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
    title: 'Подпись отдаёт распоряжение токенами',
    description:
      'Это не перевод: списания и комиссии не будет. Подпись позволит указанному адресу забрать ваши токены позже, и отменить её можно только отзывом разрешения в контракте.',
    isCritical: true,
  },
  [DAPP_RISK.UnlimitedAllowance]: {
    title: 'Сумма разрешения не ограничена',
    description:
      'Получатель сможет забрать все ваши токены этого вида — сейчас и в любой момент в будущем.',
    isCritical: true,
  },
  [DAPP_RISK.ApprovalCall]: {
    title: 'Транзакция выдаёт разрешение',
    description:
      'После неё указанный адрес получит право распоряжаться вашими токенами без отдельного подтверждения.',
    isCritical: true,
  },
  [DAPP_RISK.ChainMismatch]: {
    title: 'Запрошена другая сеть',
    description:
      'Приложение просит действие в сети, отличной от выбранной в кошельке. Подпись, сделанная не в той сети, может оказаться действительной там, где вы её не ждёте.',
    isCritical: false,
  },
  [DAPP_RISK.MissingVerifyingContract]: {
    title: 'Подписывающий контракт не указан',
    description: 'Невозможно определить, какому контракту предназначена подпись.',
    isCritical: false,
  },
  [DAPP_RISK.MessageLooksLikeTransaction]: {
    title: 'Сообщение нечитаемо',
    description:
      'Вместо текста прислана шестнадцатеричная строка. Понять, что именно подписывается, по ней нельзя.',
    isCritical: false,
  },
  [DAPP_RISK.UnreadableMessage]: {
    title: 'В сообщении скрытые символы',
    description: 'Часть текста может быть не видна на экране.',
    isCritical: false,
  },
  [DAPP_RISK.BurnRecipient]: {
    title: 'Получатель — адрес сжигания',
    description: 'Средства, отправленные туда, не получит никто.',
    isCritical: true,
  },
  [DAPP_RISK.ContractDeployment]: {
    title: 'Разворачивается контракт',
    description: 'У транзакции нет получателя: она создаёт новый контракт в сети.',
    isCritical: false,
  },
  [DAPP_RISK.OpaqueCallData]: {
    title: 'Смысл вызова не распознан',
    description:
      'Кошелёк не смог разобрать, что делает эта транзакция. Подтверждайте только если понимаете, о чём просит приложение.',
    isCritical: false,
  },
}
