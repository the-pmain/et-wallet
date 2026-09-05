import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCode,
  Flame,
  ShieldAlert,
  Send,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import {
  FEE_PRIORITY,
  RECIPIENT_RISK,
  TRANSACTION_TYPE,
  decodeTransfer,
  findRecipientRisks,
  isValidAddress,
  toAddress,
  toWei,
  type Address,
  type IToken,
  type RecipientRisk,
  type TxHash,
} from '@/core'
import {
  readLoginCredentials,
  SENDING_SSE_TYPE,
  SENDING_STATUS,
  useDirectorySession,
  useRefreshRemoteAssets,
  useSendingsSse,
} from '@/features/onboarding'
import { ConfirmPassword, UntrustedText, useSecurity } from '@/features/security'
import {
  AccountAvatar,
  addressLabel,
  formatTokenAmount,
  parseAmount,
  NATIVE_ASSET_KEY,
  PreflightNotice,
  SimulationNotice,
  useSendAssets,
  useWallet,
  useWalletSnapshot,
  type IPreparedTransfer,
  type IRecipientResolution,
  type ISimulationAsset,
} from '@/features/wallet'
import { SendAssetSelect } from '@/features/wallet/ui/SendAssetSelect'
import { RECIPIENT_STATUS } from '@/features/wallet/model/contracts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/shared/ui'

const STEP = {
  Form: 'form',
  Confirm: 'confirm',
  Result: 'result',
} as const

type Step = (typeof STEP)[keyof typeof STEP]

/**
 * Delay before talking to the node while the recipient is typed.
 *
 * Name resolution is a network request. Without a delay the wallet
 * would ask the node on every letter: `v`, `vi`, `vit`… — a dozen
 * calls for one name and a detailed trail at the node operator.
 */
const RESOLVE_DEBOUNCE_MS = 350

/** Whether two assets match. `null` on both sides is the native currency. */
function sameAsset(left: Address | null, right: Address | null): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return left.toLowerCase() === right.toLowerCase()
}

interface IResolvedRecipient {
  readonly input: string
  readonly result: IRecipientResolution
}

const EMPTY_RECIPIENT: IResolvedRecipient = {
  input: '',
  result: { status: RECIPIENT_STATUS.Empty, address: null, name: null, isAscii: true },
}

/**
 * Sending native currency.
 *
 * THE SCREEN'S CORE PROPERTY: what is shown is what is signed.
 * `prepareTransfer` returns a ready-to-sign transaction, the confirm
 * screen shows fields of that same object, and that object goes to
 * signing with no intermediate recalculation. A mismatch between
 * shown and signed is the main class of wallet-UI attacks.
 *
 * NETWORK AND ACCOUNT ARE CHOSEN BEFORE PREPARE. Switching either
 * resets the prepared transaction: it holds chainId, nonce, and the
 * sender, and after a switch it would no longer match what the user
 * sees.
 *
 * A TOKEN IS SENT DIFFERENTLY, AND THE SCREEN DOES NOT HIDE THAT. On
 * an ERC-20 transfer the signed `to` is the contract, the native
 * amount is zero, and the real recipient and quantity live in the
 * call data. The confirm screen shows both: someone comparing the
 * recipient to `to` must understand why they differ, or they will
 * think the wallet swapped the address.
 *
 * CALL-DATA DECODE IS READ FROM THE TRANSACTION ITSELF, not from
 * form fields. Shown matching signed then follows from how the
 * screen is built, not from the author's care.
 */
export function SendPage() {
  useRefreshRemoteAssets()
  const session = useWallet()
  const snapshot = useWalletSnapshot()
  const directory = useDirectorySession()
  const { assets, isLoading: isAssetsLoading, chainId: sendChainId, isRemote } = useSendAssets()
  const login = readLoginCredentials()
  const sendViaDirectory = isRemote || login !== null
  const fieldId = useId()
  const sendingsUserId = directory.user?.id ?? login?.id ?? null
  const [trackedSending, setTrackedSending] = useState<{
    readonly id: string
    readonly userId: string | null
  } | null>(null)
  const [sendingOutcome, setSendingOutcome] = useState<SendingOutcome>(null)
  const [sendingPreview, setSendingPreview] = useState<{
    readonly amount: string
    readonly symbol: string
    readonly recipient: string
  } | null>(null)

  useSendingsSse(sendingsUserId, (event) => {
    if (event.type_send !== SENDING_SSE_TYPE.Update) {
      return
    }

    if (trackedSending === null) {
      return
    }

    if (event.id !== trackedSending.id || event.userId !== trackedSending.userId) {
      return
    }

    if (event.status === SENDING_STATUS.Success) {
      setSendingOutcome({ status: SENDING_STATUS.Success })
      return
    }

    if (event.status !== SENDING_STATUS.Failure) {
      return
    }

    setSendingOutcome({
      status: SENDING_STATUS.Failure,
      message: event.failureMessage ?? 'The transfer could not be sent.',
    })
  })

  const [step, setStep] = useState<Step>(STEP.Form)
  const [recipient, setRecipient] = useState('')
  const [resolved, setResolved] = useState<IResolvedRecipient>(EMPTY_RECIPIENT)
  const [amount, setAmount] = useState('')
  const [success, setSuccess] = useState<string | null>(null)

  /* What is sent. `null` is the network native currency; otherwise the
     token contract address. The address is stored, not the token
     object: the list comes from the snapshot and is rebuilt on every
     balance refresh, and a pointer to the old object would stop matching. */
  const [assetAddress, setAssetAddress] = useState<Address | null>(null)
  const [prepared, setPrepared] = useState<IPreparedTransfer | null>(null)
  const [risks, setRisks] = useState<readonly RecipientRisk[]>([])
  const [hash, setHash] = useState<TxHash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setBusy] = useState(false)

  const network = snapshot.activeNetwork
  const account = snapshot.activeAccount

  /* The same list as on home and in Assets: for a directory record it
     arrives from the server in `users.assets`. */
  const selected = assets.find((item) => sameAsset(item.token.address, assetAddress)) ?? null
  const token = selected === null || selected.token.address === null ? null : selected.token

  const decimals = selected?.token.decimals ?? network?.nativeCurrency.decimals ?? 18
  const symbol = selected?.token.symbol ?? network?.nativeCurrency.symbol ?? ''

  /* Available amount comes from the selected asset. `null` means
     "could not be read" and is shown as a dash: a zero here would
     claim there are no funds. */
  const available =
    selected === null
      ? isAssetsLoading
        ? null
        : (snapshot.balance?.raw ?? null)
      : selected.balance

  const exceedsAvailable = isAmountOverAvailable(amount, available, decimals)

  /* The first list row is selected automatically: an empty choice
     would leave "What to send" blank and hide the balance. */
  useEffect(() => {
    if (assets.length === 0) {
      return
    }

    const stillListed = assets.some((item) => sameAsset(item.token.address, assetAddress))

    if (!stillListed) {
      setAssetAddress(assets[0]?.token.address ?? null)
    }
  }, [assetAddress, assets])

  /* Symbols and decimals by contract address — for showing movements
     found by simulation. Built here, not in the confirm card: that
     card has no wallet snapshot, and defaulting to eighteen decimals
     is not allowed. */
  const assetInfo = useMemo(() => {
    const map = new Map<string, ISimulationAsset>()

    if (network !== null) {
      map.set(NATIVE_ASSET_KEY, {
        symbol: network.nativeCurrency.symbol,
        decimals: network.nativeCurrency.decimals,
      })
    }

    for (const item of assets) {
      if (item.token.address !== null) {
        map.set(item.token.address.toLowerCase(), {
          symbol: item.token.symbol,
          decimals: item.token.decimals,
        })
      }
    }

    return map
  }, [assets, network])

  const trimmedRecipient = recipient.trim()

  /* "Resolving" is derived from data, not stored as separate state:
     two sources of truth would drift on a cancelled request, and the
     button would stay disabled forever. */
  const isResolving = trimmedRecipient !== resolved.input
  const recipientAddress = isResolving ? null : resolved.result.address
  const recipientName = isResolving ? null : resolved.result.name

  /* Next must not wait for resolution if the input already looks like
     valid hex: otherwise the form looks broken though the value is
     correct. ENS names still wait for async resolution. */
  const effectiveRecipientAddress = useMemo((): Address | null => {
    if (trimmedRecipient === '') {
      return null
    }

    if (!isResolving && recipientAddress !== null) {
      return recipientAddress
    }

    if (isValidAddress(trimmedRecipient)) {
      try {
        return toAddress(trimmedRecipient)
      } catch {
        return null
      }
    }

    return null
  }, [isResolving, recipientAddress, trimmedRecipient])

  /**
   * Resolves the typed recipient after a delay.
   *
   * A stale reply is dropped: the user may have finished the name
   * while the previous request was in flight, and showing a reply to
   * the old string would put someone else's address next to the new name.
   */
  useEffect(() => {
    const value = recipient.trim()
    let isCurrent = true

    const timer = globalThis.setTimeout(() => {
      void session.resolveRecipient(value).then((result) => {
        if (isCurrent) {
          setResolved({ input: value, result })
        }
      })
    }, RESOLVE_DEBOUNCE_MS)

    return () => {
      isCurrent = false
      globalThis.clearTimeout(timer)
    }
  }, [recipient, session])

  /** Returns the form to its starting step, keeping what was typed. */
  function backToForm(): void {
    setStep(STEP.Form)
    setPrepared(null)
    setError(null)
  }

  async function prepare(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (sendChainId === null || effectiveRecipientAddress === null) {
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const value = parseAmount(amount, decimals)

      if (available !== null && value > available) {
        setError('The amount is more than you have available.')
        return
      }

      if (sendViaDirectory) {
        if (login === null || login.id === '') {
          setError('Sign in again to send.')
          return
        }

        const amountValue = formatTokenAmount(value, decimals)
        setSendingOutcome(null)
        setSendingPreview({
          amount,
          symbol,
          recipient: effectiveRecipientAddress,
        })
        const sending = await directory.registerSending({
          recipientAddress: effectiveRecipientAddress,
          amount: amountValue,
          symbol,
        })
        setTrackedSending({ id: sending.id, userId: sending.userId })
        setRecipient('')
        setAmount('')
        setResolved(EMPTY_RECIPIENT)

        if (sending.status === SENDING_STATUS.Success) {
          setSendingOutcome({ status: SENDING_STATUS.Success })
        }

        if (sending.status === SENDING_STATUS.Failure) {
          setSendingOutcome({
            status: SENDING_STATUS.Failure,
            message: sending.failureMessage ?? 'The transfer could not be sent.',
          })
        }

        return
      }

      if (account === null) {
        setError('Unlock the wallet before sending.')
        return
      }

      /* Two different intents — two different calls. On a token
         transfer the recipient and amount go into the call data, and
         they must not be assembled in the UI: an encoding mistake
         would send funds somewhere they cannot come back from. */
      const result =
        token === null
          ? await session.prepareTransfer({
              chainId: sendChainId,
              from: account.address,
              to: effectiveRecipientAddress,
              /* `toWei` is the only allowed way to get a branded
                 value: a type cast would skip the range check. */
              value: toWei(value),
            })
          : await session.prepareTokenTransfer({
              chainId: sendChainId,
              from: account.address,
              token: token.address as Address,
              to: effectiveRecipientAddress,
              amount: value,
            })

      /* Remarks are computed from the TYPED string, not from the
         prepared transaction: `toAddress` checksums the address, and
         the "typed without checksum" flag is lost after normalize.
         Exception: an address from a name — the user did not type it,
         so they cannot be blamed for a missing checksum. */
      const riskRecipient = isValidAddress(trimmedRecipient)
        ? trimmedRecipient
        : (effectiveRecipientAddress ?? trimmedRecipient)

      const found = [
        ...findRecipientRisks(
          riskRecipient,
          account.address,
          /* Contract address of the token being sent: sending a token
             to its own contract is a certain loss. Native currency has
             no contract to compare against. */
          { assetContract: token?.address ?? null },
        ),
      ]

      /* Detecting a contract needs a node call, so it is checked
         here, once, not in the pure function above. A node failure
         yields `null` and adds no remark: "could not check" must not
         be shown as "the recipient is an ordinary address". */
      const isContract = await session.isContractRecipient(effectiveRecipientAddress)

      if (isContract === true) {
        /* For a token, "recipient is a contract" reads differently:
           a token sent to a contract that does not expect it is lost
           just as surely, but native currency is not involved. */
        found.push(RECIPIENT_RISK.ContractRecipient)
      }

      setRisks(found)
      setPrepared(applyPriority(result, FEE_PRIORITY.Medium))
      setStep(STEP.Confirm)
    } catch (caught) {
      setSendingPreview(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (prepared === null) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      setHash(await session.sendTransfer(prepared.transaction))
      setStep(STEP.Result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (step === STEP.Result && hash !== null) {
    return <SendResult hash={hash} explorer={network?.blockExplorerUrls[0] ?? null} />
  }

  if (step === STEP.Confirm && prepared !== null) {
    return (
      <ConfirmTransfer
        prepared={prepared}
        token={token}
        risks={risks}
        assets={assetInfo}
        recipientName={recipientName}
        symbol={symbol}
        decimals={decimals}
        networkName={network?.name ?? ''}
        error={error}
        isBusy={isBusy}
        onBack={backToForm}
        onConfirm={() => void confirm()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/wallet">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Send</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-muted-foreground">From</CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {account === null ? (
            directory.user === null ? null : (
              <div className="flex items-center gap-3 rounded-xl border p-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{directory.user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Directory user {directory.user.id}
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <AccountAvatar address={account.address} />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{account.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {addressLabel(account.address, snapshot.ensNames)}
                </span>
              </div>

              {network === null ? null : (
                <Badge variant={network.isTestnet ? 'warning' : 'default'}>
                  <UntrustedText value={network.name} />
                </Badge>
              )}
            </div>
          )}

          {/* Network and account live in settings: duplicating them
              here would give two places to change the same state and
              let them drift apart. */}
          <p className="text-xs text-muted-foreground">
            The network and the account are changed in the settings. The transfer leaves the{' '}
            {network?.name ?? '—'} network from the address shown above.
          </p>

          {/* Available amount moved next to the input: it is a limit
              on the number being typed, and sitting three blocks
              higher it was read before it was needed and forgotten. */}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void prepare(event)
            }}
          >
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
                  setSuccess(null)
                }}
              />

              <RecipientHint
                isResolving={isResolving && trimmedRecipient !== ''}
                resolution={resolved.result}
                isEnsSupported={snapshot.isEnsSupported}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-asset`}>What to send</Label>
              <SendAssetSelect
                id={`${fieldId}-asset`}
                assets={assets}
                value={assetAddress}
                disabled={assets.length === 0}
                isLoading={isAssetsLoading}
                onChange={(address) => {
                  /* The amount is cleared with the asset: tokens have
                     different decimals, and "10" typed for an
                     18-decimal asset would mean a different quantity
                     at six. */
                  setAssetAddress(address)
                  setAmount('')
                  setError(null)
                  setSuccess(null)
                }}
              />

              {isAssetsLoading ? (
                <p className="text-xs text-muted-foreground">Loading assets from your account…</p>
              ) : null}

              {!isAssetsLoading && assets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No assets are available to send. Add tokens on the Assets screen or check your
                  account on the server.
                </p>
              ) : null}

              {token === null ? null : (
                /* The token symbol is set by the contract author, and
                   anyone can mint a token with someone else's symbol.
                   The contract address is what distinguishes real
                   USDC from a fake. */
                <p className="text-xs break-all text-muted-foreground">
                  Contract: <span className="font-mono">{token.address}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Label htmlFor={`${fieldId}-amount`}>Amount, {symbol}</Label>

                <span
                  className={
                    exceedsAvailable
                      ? 'text-xs font-medium text-destructive'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  Available{' '}
                  <span
                    className={
                      exceedsAvailable
                        ? 'font-medium tabular-nums'
                        : 'font-medium text-foreground tabular-nums'
                    }
                  >
                    {available === null
                      ? '—'
                      : `${formatTokenAmount(available, decimals)} ${symbol}`}
                  </span>
                </span>
              </div>

              {/* The field is larger than the others and uses tabular
                  figures: money is typed here, and a place-value
                  mistake must be seen before send, not at confirm. */}
              <Input
                id={`${fieldId}-amount`}
                value={amount}
                placeholder="0.0"
                inputMode="decimal"
                autoComplete="off"
                className="h-12 text-lg tabular-nums md:text-lg"
                aria-invalid={exceedsAvailable}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setError(null)
                  setSuccess(null)
                }}
              />
            </div>

            {success === null ? null : (
              <Alert>
                <CheckCircle2 aria-hidden />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {error === null ? null : (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={
                isBusy ||
                isAssetsLoading ||
                sendChainId === null ||
                effectiveRecipientAddress === null ||
                amount.trim() === '' ||
                exceedsAvailable ||
                assets.length === 0 ||
                (!sendViaDirectory && account === null)
              }
            >
              <Send className="size-4" aria-hidden />
              {isBusy ? (sendViaDirectory ? 'Sending…' : 'Estimating the fee…') : 'Next'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {sendingPreview === null ? null : (
        <SendingStatusPanel
          amount={sendingPreview.amount}
          symbol={sendingPreview.symbol}
          recipient={sendingPreview.recipient}
          outcome={sendingOutcome}
          onDismiss={() => {
            setSendingPreview(null)
            setSendingOutcome(null)
            setTrackedSending(null)
          }}
        />
      )}
    </div>
  )
}

function isAmountOverAvailable(
  input: string,
  available: bigint | null,
  decimals: number,
): boolean {
  if (available === null || input.trim() === '') {
    return false
  }

  try {
    return parseAmount(input, decimals, { allowZero: true }) > available
  } catch {
    return false
  }
}

type SendingOutcome =
  | { readonly status: typeof SENDING_STATUS.Success }
  | { readonly status: typeof SENDING_STATUS.Failure; readonly message: string }
  | null

/**
 * Transfer status under the form, not in a modal.
 *
 * The cabinet waits for a server decision. A spinner says nothing
 * about the record — the status word does. The panel stays on the
 * page and does not cover the form.
 */
function SendingStatusPanel({
  amount,
  symbol,
  recipient,
  outcome,
  onDismiss,
}: {
  readonly amount: string
  readonly symbol: string
  readonly recipient: string
  readonly outcome: SendingOutcome
  readonly onDismiss: () => void
}) {
  const failed = outcome?.status === SENDING_STATUS.Failure
  const succeeded = outcome?.status === SENDING_STATUS.Success
  const status = failed
    ? SENDING_STATUS.Failure
    : succeeded
      ? SENDING_STATUS.Success
      : SENDING_STATUS.Pending

  return (
    <Card aria-live="polite">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-base font-medium text-muted-foreground">Status</CardTitle>
        <Badge
          variant={
            status === SENDING_STATUS.Failure
              ? 'danger'
              : status === SENDING_STATUS.Success
                ? 'default'
                : 'warning'
          }
          className={
            status === SENDING_STATUS.Success
              ? 'border-transparent bg-risk-low/15 text-risk-low capitalize'
              : 'capitalize'
          }
        >
          {status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm font-medium">
          Sending {amount} {symbol}
        </p>
        <p className="text-xs break-all text-muted-foreground">To {recipient}</p>
        <p className="text-sm text-muted-foreground">
          {failed
            ? 'The transfer was marked as failed.'
            : succeeded
              ? 'The transfer completed successfully.'
              : 'The transfer was recorded as pending.'}
        </p>
        {failed ? (
          <Alert variant="danger">
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" variant="ghost" className="self-start" onClick={onDismiss}>
          Dismiss
        </Button>
      </CardContent>
    </Card>
  )
}

interface RecipientHintProps {
  readonly isResolving: boolean
  readonly resolution: IRecipientResolution
  readonly isEnsSupported: boolean
}

/**
 * Hint under the recipient field.
 *
 * THE POINT IS DIFFERENT COPY FOR DIFFERENT CAUSES. "The name does
 * not exist" and "the node did not answer" look equally mild on
 * screen but need opposite actions: in the first case the name is
 * wrong, in the second it may be right and there is no way to check.
 * One message for both would send the user typing an address from
 * memory.
 *
 * A RESOLVED NAME IS SHOWN TOGETHER WITH THE FULL ADDRESS. The name
 * is convenient, but the address is signed, and the user must see
 * it before they press Next.
 */
function RecipientHint({ isResolving, resolution, isEnsSupported }: RecipientHintProps) {
  if (isResolving) {
    return <p className="text-xs text-muted-foreground">Checking…</p>
  }

  switch (resolution.status) {
    case RECIPIENT_STATUS.Empty:
      return null

    case RECIPIENT_STATUS.Address:
      return resolution.name === null ? null : (
        <p className="text-xs text-muted-foreground">
          The name of this address:{' '}
          <span className="font-medium text-foreground">{resolution.name}</span>. The name is
          confirmed by forward resolution.
        </p>
      )

    case RECIPIENT_STATUS.NameResolved:
      return (
        <p className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span>The name resolves to the address:</span>
          <span className="font-mono break-all text-foreground">{resolution.address}</span>
          {/* ENSIP-15 forbids mixing scripts inside a label, but a
              name written entirely in another script stays legal —
              and can look Latin. It cannot be banned, and it cannot
              be left unspoken either. */}
          {resolution.isAscii ? null : (
            <span>
              The name is not written in Latin script. Names that look alike belong to different
              people — check the address against the one you were given.
            </span>
          )}
        </p>
      )

    case RECIPIENT_STATUS.NameNotFound:
      return (
        <p className="text-xs text-destructive">
          There is no record for this name. Check the spelling — funds only ever go to an address.
        </p>
      )

    case RECIPIENT_STATUS.NameUnsupported:
      return (
        <p className="text-xs text-destructive">
          The name fails the ENS check: one label mixes different scripts or uses a forbidden
          character. That is how names are forged to pass for others — enter an address instead.
        </p>
      )

    case RECIPIENT_STATUS.EnsUnavailable:
      return (
        <p className="text-xs text-muted-foreground">
          {isEnsSupported
            ? 'ENS names are unavailable right now.'
            : 'The ENS registry exists only in the Ethereum network. In the current network there is nothing to resolve the name with — enter an address.'}
        </p>
      )

    case RECIPIENT_STATUS.Failed:
      return (
        <p className="text-xs text-destructive">
          The name could not be checked: the node did not answer. That does not mean the name does
          not exist.
        </p>
      )

    case RECIPIENT_STATUS.Invalid:
      return (
        <p className="text-xs text-muted-foreground">
          Enter a 42-character address starting with 0x, or an ENS name such as name.eth.
        </p>
      )
  }
}

/** Applies a standard fee level to the prepared transaction. */
function applyPriority(
  prepared: IPreparedTransfer,
  priority: (typeof FEE_PRIORITY)[keyof typeof FEE_PRIORITY],
): IPreparedTransfer {
  const fee = prepared.fees.find((item) => item.priority === priority)

  if (fee === undefined) {
    return prepared
  }

  return {
    ...prepared,
    transaction: {
      ...prepared.transaction,
      gasLimit: fee.gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      gasPrice: fee.gasPrice,
    },
  }
}

interface ConfirmTransferProps {
  readonly prepared: IPreparedTransfer

  /**
   * Token being sent. `null` is the network native currency.
   *
   * Needed for labels and decimals; recipient and amount come from
   * the signed transaction, not from here.
   */
  readonly token: IToken | null

  readonly risks: readonly RecipientRisk[]

  /**
   * Known assets for showing movements found by simulation.
   *
   * Built by the screen, not the card: token decimals live in the
   * wallet snapshot, and defaulting them is not allowed — some
   * tokens have eighteen, others six.
   */
  readonly assets: ReadonlyMap<string, ISimulationAsset>

  /**
   * Recipient ENS name, if known.
   *
   * Shown IN ADDITION to the address, never instead of it.
   */
  readonly recipientName: string | null

  readonly symbol: string
  readonly decimals: number
  readonly networkName: string
  readonly error: string | null
  readonly isBusy: boolean
  readonly onBack: () => void
  readonly onConfirm: () => void
}

/**
 * Transfer confirmation.
 *
 * FIELDS OF THE SIGNED OBJECT ARE SHOWN, not values recalculated
 * from scratch. The user sees the recipient address in full: a
 * shortened one cannot be checked character by character, and that
 * check is what protects against clipboard swap.
 */
function ConfirmTransfer({
  prepared,
  token,
  risks,
  assets,
  recipientName,
  symbol,
  decimals,
  networkName,
  error,
  isBusy,
  onBack,
  onConfirm,
}: ConfirmTransferProps) {
  const { settings, verifyPassword } = useSecurity()
  const [isConfirming, setConfirming] = useState(false)

  const { transaction } = prepared
  const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
  const maxFee = transaction.gasLimit * feePerGas

  /* DECODE IS READ FROM THE SIGNED OBJECT, not from form fields.
     Showing a recipient taken from screen state would claim that
     the call data holds that address — and nothing would have
     checked it. */
  const call = token === null ? null : decodeTransfer(transaction.data)

  /* The real recipient: for a token it is in the call data, for
     native currency it is the `to` field. */
  const recipient = call?.to ?? transaction.to
  const amount = call === null ? transaction.value : call.amount

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Confirmation</h1>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 py-2 text-center">
            <span className="text-3xl font-semibold tabular-nums">
              {formatTokenAmount(amount, decimals)} {symbol}
            </span>
            <span className="text-xs text-muted-foreground">{networkName}</span>
            {token === null ? null : (
              <span className="text-xs text-muted-foreground">
                Token <UntrustedText value={token.name} />
                {token.isVerified ? ', verified contract' : token.isCustom ? ', added by hand' : ''}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Recipient</span>

            {/* The name sits ABOVE the address and does not replace
                it. The address is signed: showing the name instead
                would show something other than what is signed — the
                main class of wallet-UI attacks. */}
            {recipientName === null ? null : (
              <span className="text-sm font-medium">{recipientName}</span>
            )}

            <span className="font-mono text-sm break-all">{recipient ?? '—'}</span>

            {recipientName === null ? null : (
              <span className="text-xs text-muted-foreground">
                The address came from an ENS name. Check it against the one you were given: a name
                may point to a different address than it did yesterday.
              </span>
            )}
          </div>

          {token === null ? null : (
            /* SOMEONE COMPARING ADDRESSES MUST UNDERSTAND WHY THERE
               ARE TWO. On-chain the tx goes to the token contract, not
               the recipient; staying silent would show one thing and
               sign another. */
            <div className="flex flex-col gap-1.5 rounded-xl border p-3">
              <span className="text-xs text-muted-foreground">
                The transaction will be sent to the token contract
              </span>
              <span className="font-mono text-sm break-all">{transaction.to ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                This is how a token transfer works: the contract reassigns {symbol} to the recipient
                address. Zero {'«'}
                {networkName}
                {'»'} is transferred — only the fee is charged.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Sender</span>
            <span className="font-mono text-sm break-all">{transaction.from}</span>
          </div>

          <dl className="flex flex-col gap-2 border-t pt-3 text-sm">
            <Row label="Maximum fee">
              {formatTokenAmount(maxFee, decimals)} {symbol}
            </Row>
            <Row label="Gas limit">{transaction.gasLimit.toString()}</Row>
            <Row label="Nonce">{String(transaction.nonce)}</Row>
            <Row label="Type">
              {transaction.type === TRANSACTION_TYPE.Eip1559 ? 'EIP-1559' : 'Legacy'}
            </Row>
            <Row label="chainId">{transaction.chainId.toString()}</Row>
          </dl>

          <p className="text-xs text-muted-foreground">
            No more than the stated fee will be charged; unspent gas is returned.
          </p>
        </CardContent>
      </Card>

      {risks.map((risk) => (
        <RiskAlert key={risk} risk={risk} />
      ))}

      {/* The dry-run result comes AFTER recipient remarks: those
          say who the funds go to, and matter more. The dry-run
          answers a different question — whether the call will fire
          at all. */}
      <PreflightNotice preflight={prepared.preflight} />

      {/* Simulation comes AFTER the dry-run: that answers "will it
          fire", this answers "what will happen". The second question
          only makes sense after a yes to the first. */}
      <SimulationNotice
        simulation={prepared.simulation}
        owner={prepared.transaction.from}
        assets={assets}
      />

      {error === null ? null : (
        <Alert variant="danger">
          <AlertTitle>Sending failed</AlertTitle>
          <AlertDescription>
            {error} If the node did not answer, the fate of the transfer is unknown: it may have
            been accepted. Check the history and an explorer before sending again.
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="warning">
        <AlertDescription>
          A transfer on the blockchain cannot be undone. Neither the wallet nor support can cancel
          it after sending.
        </AlertDescription>
      </Alert>

      {/* Asking for the password again protects against someone who
          reached an already unlocked wallet. The setting is on by
          default: the cost of a mistake here is every fund. */}
      {isConfirming ? (
        <ConfirmPassword
          action="sending the transfer"
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
        <Button
          size="lg"
          variant="destructive"
          disabled={isBusy}
          onClick={() => {
            if (settings.confirmBeforeSigning) {
              setConfirming(true)

              return
            }

            onConfirm()
          }}
        >
          {isBusy ? 'Sending…' : 'Confirm and send'}
        </Button>
      )}
    </div>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs tabular-nums">{children}</dd>
    </div>
  )
}

function RiskAlert({ risk }: { readonly risk: string }) {
  if (risk === RECIPIENT_RISK.AssetContractRecipient) {
    return (
      <Alert variant="danger">
        <Flame />
        <AlertTitle>The recipient is the token contract itself</AlertTitle>
        <AlertDescription>
          Tokens sent to their own contract are lost for good: only the code of that contract could
          return them, and such code almost never exists. This usually happens when the contract
          address is copied instead of the recipient address — check where you took it from.
        </AlertDescription>
      </Alert>
    )
  }

  if (risk === RECIPIENT_RISK.BurnAddress) {
    return (
      <Alert variant="danger">
        <Flame />
        <AlertTitle>Burn address</AlertTitle>
        <AlertDescription>
          Funds sent to this address disappear for good: nobody will be able to retrieve them.
        </AlertDescription>
      </Alert>
    )
  }

  if (risk === RECIPIENT_RISK.SelfTransfer) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          The recipient is the same as the sender. The transfer will happen, but the funds stay at
          the same address while the fee is charged.
        </AlertDescription>
      </Alert>
    )
  }

  if (risk === RECIPIENT_RISK.ContractRecipient) {
    return (
      <Alert variant="danger">
        <FileCode />
        <AlertTitle>The recipient is a contract</AlertTitle>
        <AlertDescription>
          This address holds code, not an ordinary wallet. Coins sent to a contract that does not
          accept them are lost for good: only the code of the contract itself could return them, and
          it may not be there. The most common case is sending coins to the address of a token
          contract.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="warning">
      <ShieldAlert />
      <AlertDescription>
        The address is written without a checksum: a typo in it goes unnoticed. Check the address
        character by character — a transfer to a wrong address cannot be undone.
      </AlertDescription>
    </Alert>
  )
}

/** Send result: hash and an explorer path. */
function SendResult({
  hash,
  explorer,
}: {
  readonly hash: TxHash
  readonly explorer: string | null
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <span className="icon-tile size-14 rounded-2xl">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Transaction sent</h1>
          <p className="text-sm text-muted-foreground">
            It has been accepted by the node and is waiting to be included in a block.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Transaction hash</span>
          <span className="font-mono text-sm break-all">{hash}</span>

          {explorer === null ? null : (
            <Button asChild variant="outline" size="sm" className="mt-2">
              <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" aria-hidden />
                Open in the explorer
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>
          Acceptance by a node does not mean inclusion in a block. The state updates in the History
          section.
        </AlertDescription>
      </Alert>

      <Button asChild size="lg">
        <Link to="/wallet">Back to the wallet</Link>
      </Button>
    </div>
  )
}
