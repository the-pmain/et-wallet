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
 * State of a stuck-transaction replacement.
 *
 * PREPARE AND SEND ARE SEPARATE. User confirmation sits between them,
 * and the object they saw must reach signing without a recalculation.
 */
interface IReplacementState {
  readonly hash: TxHash
  readonly kind: ReplacementKind

  /** `null` while the replacement is preparing or failed to prepare. */
  readonly prepared: IPreparedTransfer | null

  readonly error: string | null
  readonly isBusy: boolean
}

/**
 * Transfer history of the active account.
 *
 * SOURCE LIMITS ARE SHOWN EXPLICITLY AND DO NOT DEPEND ON THE FILTER.
 * Log scanning cannot see native-currency transfers — they emit no
 * events — and covers only a recent window of blocks. Showing that
 * sample without a caveat claims that no other operations exist; for
 * the owner that reads as a report of missing funds.
 *
 * THE FILTER APPLIES TO RECORDS ALREADY FETCHED. It does not query
 * again and cannot widen the source. An empty filter result and an
 * empty history are therefore different sentences: the first means
 * "nothing matched", the second "the source returned nothing".
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

  /* Filter state lives on the screen, not in the URL: the query
     contains a counterparty address, and the address bar is stored
     in browser history and visible to extensions. */
  const [filter, setFilter] = useState<ITransferFilter>(EMPTY_TRANSFER_FILTER)
  const network = snapshot.activeNetwork
  const [replacement, setReplacement] = useState<IReplacementState | null>(null)

  /* The request id drops a reply to a cancelled prepare: the user may
     have closed the card or picked another tx while the node priced
     gas, and a late reply would show someone else's data. */
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
    /* Bump the counter here too: otherwise a reply to a prepare that
       already started would reopen the card over a closed one. */
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
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>

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

      {/* THE MESSAGE DOES NOT PROMISE THAT "IT WILL PASS SOON".
          The old text read as a glitch you should retry. Measuring
          live nodes showed otherwise: free public nodes refuse log
          scans constantly — some demand paid archive access, some
          cut the range to fifty blocks, some ask for an account.
          An owner waiting for it to "just work" would wait forever,
          so both real outcomes are named and it is said this is not
          a glitch. */}
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
 * Replacement step for a stuck transaction.
 *
 * TAKES THE WHOLE SCREEN, it does not float over the list: signing
 * confirmation is not a background action, and attention has nothing
 * else to share with at that moment.
 *
 * A PREPARE FAILURE IS SHOWN VERBATIM. "Speed-up failed" with no
 * reason leaves the user with no next step: a failure has three
 * different outcomes — wait, update the app, or do nothing because
 * the transfer already landed.
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
        <h1 className="text-2xl font-semibold tracking-tight">
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
