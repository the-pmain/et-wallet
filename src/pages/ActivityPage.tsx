import { ChevronDown, RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { TxHash } from '@/core'
import {
  readLoginCredentials,
  useDirectorySession,
  useUserSendings,
  UserSendingsList,
} from '@/features/onboarding'
import {
  EMPTY_TRANSFER_FILTER,
  REPLACEMENT_KIND,
  ReplaceTransactionCard,
  TRANSFER_CATEGORY,
  TransferFilterBar,
  TransferList,
  filterTransfers,
  isFilterActive,
  useWallet,
  useWalletSnapshot,
  type IPreparedTransfer,
  type ITransferFilter,
  type ReplacementKind,
} from '@/features/wallet'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  SegmentedControl,
} from '@/shared/ui'

/**
 * Состояние замены зависшей транзакции.
 *
 * ПОДГОТОВКА И ОТПРАВКА РАЗДЕЛЕНЫ. Между ними стоит подтверждение
 * пользователя, и объект, который он увидел, обязан дойти до подписи
 * без пересчёта.
 */
interface IReplacementState {
  readonly hash: TxHash
  readonly kind: ReplacementKind

  /** `null`, пока замена готовится либо подготовить её не удалось. */
  readonly prepared: IPreparedTransfer | null

  readonly error: string | null
  readonly isBusy: boolean
}

/**
 * История переводов активного аккаунта.
 *
 * ОГРАНИЧЕНИЯ ИСТОЧНИКА ПОКАЗЫВАЮТСЯ ЯВНО И НЕ ЗАВИСЯТ ОТ ОТБОРА.
 * Разбор журналов узла не видит переводов нативной валюты — они не
 * порождают событий — и охватывает лишь недавнее окно блоков. Показать
 * такую выборку без оговорки значит утверждать, что других операций
 * не было; для владельца средств это равнозначно сообщению о пропаже.
 *
 * ОТБОР ПРИМЕНЯЕТСЯ К УЖЕ ПОЛУЧЕННЫМ ЗАПИСЯМ. Он ничего не запрашивает
 * заново и не может расширить выдачу источника. Поэтому пустой результат
 * отбора и пустая история описываются разными словами: первое означает
 * «под условия ничего не подошло», второе — «источник ничего не вернул».
 */
const ACTIVITY_VIEW = {
  Sendings: 'sendings',
  History: 'history',
} as const

type ActivityView = (typeof ACTIVITY_VIEW)[keyof typeof ACTIVITY_VIEW]

export function ActivityPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const directory = useDirectorySession()
  const [view, setView] = useState<ActivityView>(ACTIVITY_VIEW.Sendings)
  const canSeeSendings = directory.user !== null || readLoginCredentials() !== null
  const isSendings = canSeeSendings && view === ACTIVITY_VIEW.Sendings
  const userSendings = useUserSendings(isSendings)

  /* Условия отбора живут в состоянии экрана, а не в адресной строке:
     запрос содержит адрес контрагента, а адресная строка сохраняется
     в истории браузера и доступна расширениям. */
  const [filter, setFilter] = useState<ITransferFilter>(EMPTY_TRANSFER_FILTER)
  const network = snapshot.activeNetwork
  const [replacement, setReplacement] = useState<IReplacementState | null>(null)

  /* Номер запроса отсекает ответ на отменённую подготовку: пользователь
     мог закрыть карточку или выбрать другую транзакцию, пока узел считал
     комиссию, и опоздавший ответ показал бы чужие данные. */
  const requestId = useRef(0)

  const startReplacement = useCallback(
    (hash: TxHash, kind: ReplacementKind) => {
      const id = ++requestId.current

      setReplacement({ hash, kind, prepared: null, error: null, isBusy: false })

      const prepare =
        kind === REPLACEMENT_KIND.Cancel
          ? session.prepareCancel(hash)
          : session.prepareSpeedUp(hash)

      void prepare.then(
        (prepared) => {
          if (id === requestId.current) {
            setReplacement({ hash, kind, prepared, error: null, isBusy: false })
          }
        },
        (error: unknown) => {
          if (id === requestId.current) {
            setReplacement({
              hash,
              kind,
              prepared: null,
              error: error instanceof Error ? error.message : String(error),
              isBusy: false,
            })
          }
        },
      )
    },
    [session],
  )

  const closeReplacement = useCallback(() => {
    /* Счётчик сдвигается и здесь: иначе ответ уже начатой подготовки
       открыл бы карточку заново поверх закрытой. */
    requestId.current += 1
    setReplacement(null)
  }, [])

  const confirmReplacement = useCallback(() => {
    setReplacement((current) =>
      current === null || current.prepared === null ? current : { ...current, isBusy: true },
    )
  }, [])

  if (replacement !== null) {
    return (
      <ReplacementScreen
        state={replacement}
        network={network}
        onRetryClose={closeReplacement}
        onConfirm={() => {
          const prepared = replacement.prepared

          if (prepared === null) {
            return
          }

          const id = requestId.current

          confirmReplacement()

          void session.sendTransfer(prepared.transaction).then(
            () => {
              if (id === requestId.current) {
                closeReplacement()
              }
            },
            (error: unknown) => {
              if (id === requestId.current) {
                setReplacement({
                  ...replacement,
                  isBusy: false,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            },
          )
        }}
      />
    )
  }

  const isRefreshing = isSendings ? userSendings.isLoading : snapshot.isHistoryLoading

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Activity</h1>

        <Button
          variant="ghost"
          size="sm"
          disabled={isRefreshing}
          onClick={() => {
            if (isSendings) {
              void userSendings.refresh()
              return
            }

            void session.refreshHistory()
          }}
        >
          <RefreshCw className={isRefreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
          Refresh
        </Button>
      </header>

      {canSeeSendings ? (
        <SegmentedControl
          className="max-w-[16rem]"
          legend="View"
          value={view}
          options={[
            { value: ACTIVITY_VIEW.Sendings, label: 'Sendings' },
            { value: ACTIVITY_VIEW.History, label: 'History' },
          ]}
          onChange={setView}
        />
      ) : null}

      {isSendings ? (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <UserSendingsList
              sendings={userSendings.sendings}
              isLoading={userSendings.isLoading}
              error={userSendings.error}
            />
          </CardContent>
        </Card>
      ) : (
        <ActivityHistory
          filter={filter}
          onFilterChange={setFilter}
          snapshot={snapshot}
          startReplacement={startReplacement}
        />
      )}
    </div>
  )
}

function ActivityHistory({
  filter,
  onFilterChange,
  snapshot,
  startReplacement,
}: {
  readonly filter: ITransferFilter
  readonly onFilterChange: (filter: ITransferFilter) => void
  readonly snapshot: ReturnType<typeof useWalletSnapshot>
  readonly startReplacement: (hash: TxHash, kind: ReplacementKind) => void
}) {
  const network = snapshot.activeNetwork
  const limits = snapshot.historyLimits
  const nativeSymbol = network?.nativeCurrency.symbol ?? null
  const transfers = snapshot.transfers
  const visible = useMemo(() => filterTransfers(transfers, filter), [transfers, filter])
  const hasFilter = isFilterActive(filter)
  const hasMore = snapshot.historyCursor !== null
  const isNativeBlindSpot =
    filter.category === TRANSFER_CATEGORY.Native && limits?.nativeTransfersUnavailable === true
  const session = useWallet()

  return (
    <>

      {/* СООБЩЕНИЕ НЕ ОБЕЩАЕТ, ЧТО «СКОРО ПРОЙДЁТ».
          Прежний текст звучал как рассказ о сбое, после которого стоит
          повторить попытку. Измерение живых узлов показало другое:
          бесплатные публичные узлы отказывают в выборке журналов
          постоянно — кто требует платного архивного доступа, кто режет
          диапазон до пятидесяти блоков, кто просит учётную запись.
          Владелец, ждущий, что «само наладится», прождёт вечно, поэтому
          названы обе настоящие развязки и сказано, что дело не в сбое. */}
      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            The history could not be fetched, so only the sends made from this wallet are shown.
            That does not mean there were no other operations.
            {limits.reason === null ? null : <> The node replied: "{limits.reason}".</>} This is
            usually not a temporary failure: free public nodes refuse log searches as a rule — some
            require a paid archive plan, others cap the range at a few dozen blocks. Retrying will
            not help. Connect your own node in the settings, or provide an indexer key.
          </AlertDescription>
        </Alert>
      ) : null}

      <TransferFilterBar filter={filter} onChange={onFilterChange} nativeSymbol={nativeSymbol} />

      {hasFilter && transfers.length > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing {visible.length} of {transfers.length} loaded
          {hasMore ? ' — the filter does not reach the part that is not loaded yet' : null}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0 sm:p-0">
          <TransferList
            transfers={visible}
            network={network}
            isLoading={snapshot.isHistoryLoading}
            onReplace={startReplacement}
            emptyTitle={
              hasFilter
                ? hasMore
                  ? 'Nothing matched among the loaded records'
                  : 'Nothing matched the filter'
                : hasMore
                  ? 'No operations in the loaded part'
                  : 'No operations yet'
            }
            emptyDescription={
              hasFilter ? (
                <>
                  The filter applies to records already fetched and does not query the history
                  again.
                  {hasMore ? (
                    <>
                      {' '}
                      Older operations have not been loaded, so this is not an answer about them —
                      load the earlier part and repeat the search.
                    </>
                  ) : null}
                  {isNativeBlindSpot ? (
                    <>
                      {' '}
                      {nativeSymbol ?? 'Native currency'} transfers are unavailable to this source
                      in principle, so an empty list here says nothing about whether such operations
                      happened.
                    </>
                  ) : null}{' '}
                  Clear the filter to see everything that could be fetched.
                </>
              ) : (
                'No operations were found.'
              )
            }
          />

          {hasMore ? (
            <div className="border-t p-3">
              <Button
                variant="outline"
                className="w-full"
                disabled={snapshot.isHistoryLoadingMore}
                onClick={() => void session.loadMoreHistory()}
              >
                {snapshot.isHistoryLoadingMore ? (
                  <RefreshCw className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ChevronDown className="size-4" aria-hidden />
                )}
                {snapshot.isHistoryLoadingMore ? 'Loading earlier operations…' : 'Load earlier'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * Шаг замены зависшей транзакции.
 *
 * ЗАНИМАЕТ ЭКРАН ЦЕЛИКОМ, а не всплывает над списком: подтверждение
 * подписи — не фоновое действие, и внимание в этот момент делить не с чем.
 *
 * ОТКАЗ ПОДГОТОВКИ ПОКАЗЫВАЕТСЯ ДОСЛОВНО. «Ускорить не удалось» без
 * причины не даёт понять, что делать: у отказа три разных исхода —
 * подождать, обновить приложение либо не делать ничего, потому что
 * перевод уже прошёл.
 */
function ReplacementScreen({
  state,
  network,
  onRetryClose,
  onConfirm,
}: {
  readonly state: IReplacementState
  readonly network: ReturnType<typeof useWalletSnapshot>['activeNetwork']
  readonly onRetryClose: () => void
  readonly onConfirm: () => void
}) {
  const isCancel = state.kind === REPLACEMENT_KIND.Cancel

  if (state.prepared === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">
          {isCancel ? 'Cancelling a transaction' : 'Speeding up a transaction'}
        </h1>

        {state.error === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            Preparing the replacement…
          </div>
        ) : (
          <Alert variant="danger">
            <AlertTitle>The transaction cannot be replaced</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <Button variant="outline" onClick={onRetryClose}>
          Back to the history
        </Button>
      </div>
    )
  }

  return (
    <ReplaceTransactionCard
      kind={state.kind}
      prepared={state.prepared}
      network={network}
      isBusy={state.isBusy}
      error={state.error}
      onConfirm={onConfirm}
      onCancel={onRetryClose}
    />
  )
}
