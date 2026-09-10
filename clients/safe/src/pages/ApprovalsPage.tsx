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
  Skeleton,
} from '@/shared/ui'

interface IRevokeState {
  readonly record: IApprovalRecord
  readonly prepared: IPreparedTransfer | null
  readonly error: string | null
  readonly isBusy: boolean
}

/**
 * Approvals granted by the active account.
 *
 * WHY THIS SCREEN EXISTS. Funds today leave through a forgotten
 * approval, not a stolen key: someone once let a contract spend tokens
 * without a cap, and a year later that contract was hacked or was
 * fraudulent from the start. The key is intact, the wallet is "not
 * hacked", and the funds are gone. Without this screen the owner
 * cannot see what was granted or take it back.
 *
 * THE LIST IS BUILT IN TWO STEPS. Logs give grants; the contract says
 * whether the approval is still live. A list from logs alone would
 * scare the owner with grants that are long gone and devalue real
 * findings.
 *
 * THE OWNER STARTS THE SEARCH BY OPENING THE SECTION: it is dozens of
 * node calls and a detailed activity trail at the operator.
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

  /* Which account+network pair already started a search. */
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

        /* The list is fetched again: until the tx is in a block the
           approval is still live, and it must not be shown as revoked. */
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
          <Button asChild variant="ghost" size="icon" aria-label="Back">
            <Link to="/wallet/settings">
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
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
          Refresh
        </Button>
      </header>

      {sentHash === null ? null : (
        <Alert>
          <AlertDescription>
            The revocation has been sent. The approval stops working once the transaction lands in a
            block; until then it remains in force.
          </AlertDescription>
        </Alert>
      )}

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            The approvals could not be checked: the node did not answer.
            {limits.reason === null ? null : <> It reported: "{limits.reason}".</>} An empty list
            here does not mean there are no approvals.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits !== null && limits.skipped > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            Not every approval found was checked: {limits.skipped.toLocaleString('en-GB')} remain
            unverified. Each check is a separate call to a contract, and their number is limited so
            that the node does not refuse service.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className={items !== null && items.length > 0 ? 'p-0 sm:p-0' : undefined}>
          {snapshot.isApprovalsLoading && items === null ? (
            <div className="divide-y divide-border" aria-busy>
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 px-4 py-3.5 sm:px-6"
                  aria-hidden
                >
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
              <span className="sr-only">Checking the approvals…</span>
            </div>
          ) : items === null || items.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No active approvals found"
              description={
                <>
                  The wallet scans the last{' '}
                  {limits === null || limits.scannedBlocks === null
                    ? 'blocks'
                    : `${limits.scannedBlocks.toLocaleString('en-GB')} blocks`}{' '}
                  and checks every approval it finds against the contract. Anything granted before
                  that window will not appear here — check the address in an explorer if you used
                  applications long ago.
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

      {/*
        THE WEIGHT OF THE WARNING DEPENDS ON WHETHER THERE IS SOMETHING
        TO WARN ABOUT.

        The text is the same; the placement is not. When approvals
        exist, the danger is live now, and the warning must look like
        a warning. When the list is empty there is nothing to take —
        and the same orange block would report risk where there is
        none. False alarms train people not to read real ones, and
        approvals are the most common way to lose funds with an
        intact key, so that habit costs the most here.

        That is why the text is NOT removed from the empty state:
        learning what an approval can do is more useful before one
        is granted.
      */}
      {items !== null && items.length > 0 ? (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertDescription>{APPROVAL_RISK_TEXT}</AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{APPROVAL_RISK_TEXT}</span>
        </p>
      )}
    </div>
  )
}

/**
 * What an approval can do.
 *
 * Kept in one constant because it is shown in two forms — a warning
 * and a footnote — and a drift between two copies would be noticed
 * only after someone read both.
 */
const APPROVAL_RISK_TEXT =
  'An approval lets a contract take your tokens without a new signature. It does not expire on its own: until you revoke it, it keeps working long after the application is no longer needed. Revoking is an ordinary transaction and costs a fee.'

/**
 * A row in the approvals list.
 *
 * AN UNLIMITED APPROVAL IS MARKED AS DANGER, not labeled neutrally:
 * the difference between "50 USDC allowed" and "everything allowed"
 * is the difference between losing fifty dollars and losing the
 * balance.
 *
 * THE SPENDER ADDRESS IS ALWAYS SHOWN. The wallet does not know the
 * contract's name, and calling it "an exchange" would be invention.
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
            {record.standard === TOKEN_STANDARD.Erc20 ? 'Token' : 'Collection'}
          </Badge>
        </span>

        <span className="truncate text-xs text-muted-foreground">
          To: <span className="font-mono">{shortenAddress(record.spender)}</span>
        </span>

        <span className="text-xs">
          {record.isUnlimited ? (
            <span className="font-medium text-destructive">
              {record.standard === TOKEN_STANDARD.Erc20
                ? 'Unlimited amount'
                : 'The whole collection, including future items'}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Up to{' '}
              {record.decimals === null
                ? `${(record.amount ?? 0n).toString()} units`
                : `${formatTokenAmount(record.amount ?? 0n, record.decimals)} ${record.symbol ?? ''}`}
            </span>
          )}
        </span>
      </span>

      <Button variant="outline" size="sm" className="shrink-0" onClick={onRevoke}>
        Revoke
      </Button>
    </div>
  )
}

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
      <h1 className="text-2xl font-semibold tracking-tight">Revoke the approval</h1>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Contract</span>
            <span className="font-mono text-sm break-all">{record.contract}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Granted to</span>
            <span className="font-mono text-sm break-all">{record.spender}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            After the confirmation the contract will no longer be able to dispose of your funds.
            Operations it has already carried out are not undone by this.
          </p>
        </CardContent>
      </Card>

      {state.error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>Revoking failed</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {prepared === null ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          {state.isBusy ? (
            <>
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Preparing the revocation…
            </>
          ) : null}
        </div>
      ) : null}

      {isConfirming ? (
        <ConfirmPassword
          action="revoking the approval"
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
            {state.isBusy ? 'Sending…' : 'Revoke the approval'}
          </Button>

          <Button variant="ghost" className="sm:flex-1" disabled={state.isBusy} onClick={onBack}>
            Back
          </Button>
        </div>
      )}
    </div>
  )
}
