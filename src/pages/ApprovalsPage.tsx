import { ArrowLeft, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { TOKEN_STANDARD, type IApprovalRecord, type TxHash } from '@/core'
import { ConfirmPassword, useSecurity } from '@/features/security'
import {
  formatTokenAmount,
  shortenAddress,
  useWallet,
  useWalletSnapshot,
  type IPreparedTransfer,
} from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
} from '@/shared/ui'

/** Что происходит с отзывом прямо сейчас. */
interface IRevokeState {
  readonly record: IApprovalRecord
  readonly prepared: IPreparedTransfer | null
  readonly error: string | null
  readonly isBusy: boolean
}

/**
 * Разрешения, выданные активным аккаунтом.
 *
 * ЗАЧЕМ ЭТОТ ЭКРАН СУЩЕСТВУЕТ. Средства сегодня уводят не кражей ключа,
 * а забытым разрешением: человек однажды разрешил контракту распоряжаться
 * токенами без ограничения суммы, а через год этот контракт оказался
 * взломан либо изначально принадлежал мошеннику. Ключ при этом цел,
 * кошелёк «не взломан», а средств нет. Без такого экрана владелец
 * не может ни узнать о выданном, ни забрать его обратно.
 *
 * СПИСОК СТРОИТСЯ В ДВА ШАГА. Журнал даёт выдачи, контракт отвечает,
 * действует ли разрешение сейчас. Список по одним журналам пугал бы
 * владельца тем, чего давно нет, и обесценил бы настоящие находки.
 *
 * ПОИСК ЗАПУСКАЕТ ВЛАДЕЛЕЦ, ОТКРЫВАЯ РАЗДЕЛ: это десятки обращений
 * к узлу и подробный след активности у его оператора.
 */
export function ApprovalsPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const { settings, verifyPassword } = useSecurity()

  const items = snapshot.approvals
  const limits = snapshot.approvalLimits
  const network = snapshot.activeNetwork
  const account = snapshot.activeAccount

  const [revoke, setRevoke] = useState<IRevokeState | null>(null)
  const [isConfirming, setConfirming] = useState(false)
  const [sentHash, setSentHash] = useState<TxHash | null>(null)

  /* Для какой пары «аккаунт и сеть» поиск уже запускали. */
  const requestedFor = useRef<string | null>(null)
  const scope = `${network?.chainId.toString() ?? ''}:${account?.id ?? ''}`

  useEffect(() => {
    if (items === null && requestedFor.current !== scope) {
      requestedFor.current = scope
      void session.loadApprovals()
    }
  }, [items, scope, session])

  function startRevoke(record: IApprovalRecord): void {
    if (account === null) {
      return
    }

    setSentHash(null)
    setRevoke({ record, prepared: null, error: null, isBusy: true })

    void session
      .prepareRevokeApproval({
        chainId: record.chainId,
        from: account.address,
        contract: record.contract,
        spender: record.spender,
        standard: record.standard,
      })
      .then(
        (prepared) => {
          setRevoke({ record, prepared, error: null, isBusy: false })
        },
        (error: unknown) => {
          setRevoke({
            record,
            prepared: null,
            error: error instanceof Error ? error.message : String(error),
            isBusy: false,
          })
        },
      )
  }

  function send(): void {
    const prepared = revoke?.prepared

    if (revoke === undefined || revoke === null || prepared === null || prepared === undefined) {
      return
    }

    setRevoke({ ...revoke, isBusy: true })

    void session.sendTransfer(prepared.transaction).then(
      (hash) => {
        setRevoke(null)
        setSentHash(hash)

        /* Список перезапрашивается: пока транзакция не в блоке,
           разрешение ещё действует, и показывать его снятым нельзя. */
        void session.loadApprovals()
      },
      (error: unknown) => {
        setRevoke({
          ...revoke,
          isBusy: false,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }

  if (revoke !== null) {
    return (
      <RevokeScreen
        state={revoke}
        isConfirming={isConfirming}
        onVerify={verifyPassword}
        onConfirmRequested={() => {
          if (settings.confirmBeforeSigning) {
            setConfirming(true)

            return
          }

          send()
        }}
        onConfirmed={() => {
          setConfirming(false)
          send()
        }}
        onCancelConfirm={() => {
          setConfirming(false)
        }}
        onBack={() => {
          setConfirming(false)
          setRevoke(null)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Назад">
            <Link to="/wallet/settings">
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Разрешения</h1>
        </div>

        <Button
          variant="ghost"
          size="sm"
          disabled={snapshot.isApprovalsLoading}
          onClick={() => void session.loadApprovals()}
        >
          <RefreshCw
            className={snapshot.isApprovalsLoading ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden
          />
          Обновить
        </Button>
      </header>

      {sentHash === null ? null : (
        <Alert>
          <AlertDescription>
            Отзыв отправлен. Разрешение перестанет действовать, когда транзакция попадёт в блок; до
            тех пор оно остаётся в силе.
          </AlertDescription>
        </Alert>
      )}

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            Проверить разрешения не удалось: узел не ответил.
            {limits.reason === null ? null : <> Он сообщил: «{limits.reason}».</>} Пустой список
            здесь не означает, что разрешений нет.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits !== null && limits.skipped > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            Проверены не все найденные выдачи: {limits.skipped.toLocaleString('ru-RU')} осталось
            непроверенными. Каждая проверка — отдельное обращение к контракту, и их число
            ограничено, чтобы узел не отказал в обслуживании.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className={items !== null && items.length > 0 ? 'p-0 sm:p-0' : undefined}>
          {snapshot.isApprovalsLoading && items === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Проверяем разрешения…
            </div>
          ) : items === null || items.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="Действующих разрешений не найдено"
              description={
                <>
                  Кошелёк просматривает последние{' '}
                  {limits === null || limits.scannedBlocks === null
                    ? 'блоки'
                    : `${limits.scannedBlocks.toLocaleString('ru-RU')} блоков`}{' '}
                  и проверяет каждое найденное разрешение в контракте. Выданное раньше этого окна
                  сюда не попадёт — проверьте адрес в обозревателе, если пользовались приложениями
                  давно.
                </>
              }
            />
          ) : (
            <ul className="divide-y">
              {items.map((record) => (
                <li key={`${record.contract}:${record.spender}:${record.standard}`}>
                  <ApprovalRow
                    record={record}
                    onRevoke={() => {
                      startRevoke(record)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>
          Разрешение позволяет контракту забирать ваши токены без новой подписи. Оно не истекает
          само: пока вы его не отзовёте, оно действует и после того, как приложение стало ненужным.
          Отзыв — обычная транзакция, за неё списывается комиссия.
        </AlertDescription>
      </Alert>
    </div>
  )
}

/**
 * Строка списка разрешений.
 *
 * НЕОГРАНИЧЕННОЕ РАЗРЕШЕНИЕ ВЫДЕЛЕНО КАК ОПАСНОСТЬ, а не помечено
 * нейтрально: разница между «разрешено 50 USDC» и «разрешено всё»
 * и есть разница между потерей пятидесяти долларов и потерей баланса.
 *
 * АДРЕС ПОЛУЧАТЕЛЯ РАЗРЕШЕНИЯ ПОКАЗЫВАЕТСЯ ВСЕГДА. Имя контракта
 * кошельку неизвестно, и назвать его «биржей» было бы выдумкой.
 */
function ApprovalRow({
  record,
  onRevoke,
}: {
  readonly record: IApprovalRecord
  readonly onRevoke: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <span
        className={
          record.isUnlimited
            ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive'
            : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground'
        }
      >
        <ShieldAlert className="size-5" aria-hidden />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {record.symbol ?? shortenAddress(record.contract)}
          </span>
          <Badge variant="outline">
            {record.standard === TOKEN_STANDARD.Erc20 ? 'Токен' : 'Коллекция'}
          </Badge>
        </span>

        <span className="truncate text-xs text-muted-foreground">
          Кому: <span className="font-mono">{shortenAddress(record.spender)}</span>
        </span>

        <span className="text-xs">
          {record.isUnlimited ? (
            <span className="font-medium text-destructive">
              {record.standard === TOKEN_STANDARD.Erc20
                ? 'Без ограничения суммы'
                : 'Вся коллекция, включая будущие предметы'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              До{' '}
              {record.decimals === null
                ? `${(record.amount ?? 0n).toString()} ед.`
                : `${formatTokenAmount(record.amount ?? 0n, record.decimals)} ${record.symbol ?? ''}`}
            </span>
          )}
        </span>
      </span>

      <Button variant="outline" size="sm" className="shrink-0" onClick={onRevoke}>
        Отозвать
      </Button>
    </div>
  )
}

/** Подтверждение отзыва. */
function RevokeScreen({
  state,
  isConfirming,
  onVerify,
  onConfirmRequested,
  onConfirmed,
  onCancelConfirm,
  onBack,
}: {
  readonly state: IRevokeState
  readonly isConfirming: boolean
  readonly onVerify: (password: string) => Promise<boolean>
  readonly onConfirmRequested: () => void
  readonly onConfirmed: () => void
  readonly onCancelConfirm: () => void
  readonly onBack: () => void
}) {
  const { record, prepared } = state

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Отзыв разрешения</h1>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Контракт</span>
            <span className="font-mono text-sm break-all">{record.contract}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Кому было разрешено</span>
            <span className="font-mono text-sm break-all">{record.spender}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            После подтверждения контракт больше не сможет распоряжаться вашими средствами. Уже
            выполненные им операции это не отменяет.
          </p>
        </CardContent>
      </Card>

      {state.error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>Отозвать не удалось</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {prepared === null ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          {state.isBusy ? (
            <>
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Готовим отзыв…
            </>
          ) : null}
        </div>
      ) : null}

      {isConfirming ? (
        <ConfirmPassword
          action="отзыв разрешения"
          onVerify={onVerify}
          onConfirmed={onConfirmed}
          onCancel={onCancelConfirm}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="sm:flex-1"
            disabled={state.isBusy || prepared === null}
            onClick={onConfirmRequested}
          >
            {state.isBusy ? 'Отправка…' : 'Отозвать разрешение'}
          </Button>

          <Button variant="ghost" className="sm:flex-1" disabled={state.isBusy} onClick={onBack}>
            Назад
          </Button>
        </div>
      )}
    </div>
  )
}
