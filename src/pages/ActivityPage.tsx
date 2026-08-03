import { ChevronDown, Info, RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { TxHash } from '@/core'
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
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from '@/shared/ui'

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
export function ActivityPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  /* Условия отбора живут в состоянии экрана, а не в адресной строке:
     запрос содержит адрес контрагента, а адресная строка сохраняется
     в истории браузера и доступна расширениям. */
  const [filter, setFilter] = useState<ITransferFilter>(EMPTY_TRANSFER_FILTER)

  const network = snapshot.activeNetwork
  const limits = snapshot.historyLimits
  const nativeSymbol = network?.nativeCurrency.symbol ?? null

  const transfers = snapshot.transfers
  const visible = useMemo(() => filterTransfers(transfers, filter), [transfers, filter])

  const hasFilter = isFilterActive(filter)

  /* Есть ли за показанным ещё история. От этого зависят два разных
     утверждения в пустом состоянии: «таких операций нет» и «среди
     загруженных таких нет». Первое кошелёк вправе сделать, только
     дочитав историю до конца. */
  const hasMore = snapshot.historyCursor !== null

  /* Отбор по нативной валюте при источнике, который её не видит, даёт
     пустой список. Без объяснения он читается как «переводов не было» —
     утверждение, которого кошелёк в этом случае делать не вправе. */
  const isNativeBlindSpot =
    filter.category === TRANSFER_CATEGORY.Native && limits?.nativeTransfersUnavailable === true

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

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">History</h1>

        <Button
          variant="ghost"
          size="sm"
          disabled={snapshot.isHistoryLoading}
          onClick={() => void session.refreshHistory()}
        >
          <RefreshCw
            className={snapshot.isHistoryLoading ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden
          />
          Refresh
        </Button>
      </header>

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            The history could not be fetched, so only the sends made from this wallet are shown.
            That does not mean there were no other operations.
            {limits.reason === null ? null : <> The node replied: "{limits.reason}".</>} Many public
            nodes refuse to search across every contract at once. Connect your own node in the
            settings or provide an indexer key.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits?.nativeTransfersUnavailable === true ? (
        <Alert variant="warning">
          <AlertDescription>
            {nativeSymbol ?? 'Native currency'} transfers are not shown here. The wallet reads the
            history from node logs, and such transfers emit no events and are absent from the logs.
            A full history needs an indexer — it receives your address and every operation on it.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits?.scannedBlocks === null || limits === null ? null : (
        <Alert>
          <Info />
          <AlertDescription>
            {limits.scannedBlocks.toLocaleString('en-GB')} blocks were scanned. A single node query
            returns no more than that
            {hasMore ? ', so earlier operations have to be loaded separately' : null}.
          </AlertDescription>
        </Alert>
      )}

      <TransferFilterBar filter={filter} onChange={setFilter} nativeSymbol={nativeSymbol} />

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
                <>
                  {hasMore
                    ? 'Nothing was found in the part that has been loaded. This says nothing about the earlier part — it has not been fetched.'
                    : 'No operations were found for the available period.'}{' '}
                  The wallet shows transfers of the native currency, ERC-20 tokens and collectible
                  tokens — as far as the connected source reports them.
                </>
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
    </div>
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
