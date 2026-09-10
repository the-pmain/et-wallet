import type {
  AccountId,
  Address,
  ChainId,
  IAddNetworkParams,
  IAccount,
  IBackupManager,
  IBalance,
  IDappRequest,
  IAddHardwareAccountParams,
  IHistoryCursor,
  IHistoryLimits,
  IPreflightResult,
  ISimulationResult,
  INetworkConfig,
  IFeeEstimate,
  IApprovalLimits,
  IApprovalRecord,
  INftItem,
  INftLimits,
  INftTransferRequest,
  IRevokeApprovalRequest,
  IPortfolioSummary,
  IRpcEndpoint,
  IRpcEndpointHealth,
  ISignableTransaction,
  ITenderlyCredentials,
  IToken,
  ITokenMetadata,
  ITokenTransferRequest,
  ITransactionRequest,
  ITransferRecord,
  TxHash,
} from '@/core'

/**
 * Token together with its balance.
 *
 * The balance is optional: the contract may have stopped answering,
 * and losing the whole list for that is worse than showing a row
 * without an amount. `null` means "could not read", not zero.
 */
export interface ITokenBalance {
  readonly token: IToken
  readonly balance: bigint | null
}

/**
 * A prepared transfer together with fee options.
 *
 * `transaction` is exactly the object that will be signed. The
 * confirmation screen shows its fields, and the same object is
 * passed to `sendTransfer`.
 */
export interface IPreparedTransfer {
  readonly transaction: ISignableTransaction
  readonly fees: readonly IFeeEstimate[]

  /**
   * Result of running the call on the node before signing.
   *
   * Always shown, including "could not check". Wallet silence
   * about a skipped check reads as the check having passed.
   */
  readonly preflight: IPreflightResult

  /**
   * What the transaction will do against the current chain state.
   *
   * Always shown, including "node cannot" and "could not check".
   * An empty movement list is meaningful only when the simulation
   * succeeded: otherwise it would mean "nothing will move" where
   * the wallet simply did not look.
   */
  readonly simulation: ISimulationResult
}

/** Result of searching for used addresses. */
export interface IAccountDiscoverySummary {
  readonly added: number

  /** Addresses checked. Needed to name the depth honestly. */
  readonly scanned: number

  /**
   * The search stopped at the limit, not at a gap of empty
   * addresses.
   *
   * Used addresses may remain beyond it, so it is not allowed
   * to say "these are all your accounts".
   */
  readonly stoppedByLimit: boolean
}

/**
 * Result of parsing what was typed in the recipient field.
 *
 * Why so many states. "The name does not exist", "the name uses
 * characters we do not support", "ENS does not work on this
 * network", and "the node did not answer" need different user
 * actions. Collapse them into one "invalid recipient" and a
 * person whose node just dropped will decide the name does not
 * exist and send funds to an address typed from memory.
 */
export const RECIPIENT_STATUS = {
  Empty: 'empty',
  Address: 'address',
  /** The name resolved to an address. */
  NameResolved: 'name-resolved',
  /** Looks like a name, but there is no record for it. */
  NameNotFound: 'name-not-found',
  /** The name contains characters outside the supported set. */
  NameUnsupported: 'name-unsupported',
  /** The active network has no ENS registry. */
  EnsUnavailable: 'ens-unavailable',
  /** The node did not answer: the name could not be checked. */
  Failed: 'failed',
  /** The input is neither an address nor a name. */
  Invalid: 'invalid',
} as const

export type RecipientStatus = (typeof RECIPIENT_STATUS)[keyof typeof RECIPIENT_STATUS]

export interface IRecipientResolution {
  readonly status: RecipientStatus

  /** Recipient address. `null` until one exists. */
  readonly address: Address | null

  /**
   * The name linked to the address, in display form.
   *
   * For a typed name — the one the address came from. For a
   * typed address — a verified reverse record, if any. `null`
   * otherwise.
   */
  readonly name: string | null

  /**
   * The name is written in ASCII only.
   *
   * ENSIP-15 forbids mixing scripts inside a label, but a name
   * written entirely in another script and look-alike to a Latin
   * one stays legal and belongs to someone else. `true` when
   * there is no name: nothing to caveat.
   */
  readonly isAscii: boolean
}

export const SESSION_STATE = {
  /** Wallet locked or not yet created: no services exist. */
  Closed: 'closed',
  Opening: 'opening',
  Open: 'open',
  /** Could not open. The reason is in the snapshot. */
  Failed: 'failed',
} as const

export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE]

/**
 * Immutable wallet-state snapshot for the UI.
 *
 * Why a snapshot, not a set of getters. `useSyncExternalStore`
 * compares `getSnapshot()` by reference and redraws when it
 * changes. Getters that assemble a new object on every call
 * would give a new reference on every render and an infinite
 * redraw loop.
 *
 * Data fields update by replacing the whole snapshot.
 */
export interface IWalletSnapshot {
  readonly state: SessionState

  /** Failure reason when `state === Failed`. */
  readonly error: string | null

  readonly accounts: readonly IAccount[]
  readonly activeAccount: IAccount | null

  readonly networks: readonly INetworkConfig[]
  readonly activeNetwork: INetworkConfig | null

  /** Active-account balance on the active network. `null` until fetched. */
  readonly balance: IBalance | null

  readonly balanceError: string | null

  readonly isBalanceLoading: boolean

  /**
   * Transfer history of the active account on the active network.
   *
   * Includes native, ERC-20, and collectible transfers — in the
   * volume the connected source can give. Limits live in
   * `historyLimits` and must be shown: incomplete history passed
   * off as complete reads as missing funds.
   */
  readonly transfers: readonly ITransferRecord[]

  /** What limits the shown history. `null` until it is loaded. */
  readonly historyLimits: IHistoryLimits | null

  readonly isHistoryLoading: boolean

  /**
   * How to continue history. `null` means there is nothing more.
   *
   * Distinguishes "this is all history" from "this is the first
   * stretch". Filter and search run over loaded records, and an
   * empty result with a non-null cursor means only "none among
   * what is loaded", not "those operations never happened".
   */
  readonly historyCursor: IHistoryCursor | null

  readonly isHistoryLoadingMore: boolean

  /**
   * Tracked tokens of the active network with balances.
   *
   * Native currency comes first: it exists on every network and
   * cannot be removed.
   */
  readonly tokenBalances: readonly ITokenBalance[]

  readonly isTokensLoading: boolean

  /**
   * Collectibles of the active account on the active network.
   *
   * `null` means "never asked", an empty array means "none
   * found". The difference matters: the first asserts nothing,
   * the second asserts a search happened.
   *
   * The list is not loaded by itself. Search needs a log scan
   * and a call to every found contract — dozens of node hits
   * and a detailed activity trail for its operator. The owner
   * requests them by opening the section.
   */
  readonly nfts: readonly INftItem[] | null

  /** What limits the shown item list. `null` before a request. */
  readonly nftLimits: INftLimits | null

  readonly isNftLoading: boolean

  /**
   * Approvals issued by the active account on the active network.
   *
   * `null` means "never asked", an empty array means "no live
   * approvals found". The difference matters: the first asserts
   * nothing, the second asserts a search happened.
   *
   * The list is not loaded by itself — same as collectibles: a
   * log scan and a call to every found contract.
   */
  readonly approvals: readonly IApprovalRecord[] | null

  /** What limits the shown approval list. `null` before a request. */
  readonly approvalLimits: IApprovalLimits | null

  readonly isApprovalsLoading: boolean

  /**
   * Portfolio estimate of the active account on the active network.
   *
   * `null` until rates are requested or the source is not
   * connected. An empty summary and a missing summary mean
   * different things: the first is "no assets", the second is
   * "value unknown".
   */
  readonly portfolio: IPortfolioSummary | null

  /**
   * The user allowed a third-party price source.
   *
   * Until there is consent the wallet does not request rates:
   * the request names the contract address to the service, i.e.
   * discloses the portfolio.
   */
  readonly arePricesEnabled: boolean

  readonly isPortfolioLoading: boolean

  readonly priceError: string | null

  /** Connected price-source name. The user has a right to know it. */
  readonly priceSourceName: string

  /**
   * Credentials for a third-party simulation source are entered.
   *
   * Separate from consent: credentials can be entered without
   * enabling the source, and consent without data does nothing.
   */
  readonly isTenderlyConfigured: boolean

  /**
   * Consent to a third-party simulation source.
   *
   * Until there is consent, transaction effects are computed by
   * the node — the same one the wallet already talks to. A third
   * party learns the spend intent before signing, and that is
   * the owner's decision.
   */
  readonly isSimulationSourceEnabled: boolean

  /**
   * Name of the source asked first. `null` — node only.
   *
   * The confirmation screen must name who answered: "checked"
   * without the checker's name means nothing.
   */
  readonly simulationSourceName: string | null

  /**
   * Verified ENS names of the wallet's accounts.
   *
   * Key is the address in lowercase. A key's presence means the
   * reverse record exists AND is confirmed by a forward resolve:
   * unverified names are never stored here.
   *
   * Empty when the active network has no ENS: a name shown
   * outside the network where it is valid would claim more than
   * is known.
   */
  readonly ensNames: ReadonlyMap<string, string>

  readonly isEnsSupported: boolean

  /**
   * RPC endpoints of the active network, in preference order.
   *
   * The user must see whose node the wallet talks to: "it works"
   * and "it works through a third-party operator who sees all
   * your addresses" are different claims.
   */
  readonly rpcEndpoints: readonly IRpcEndpoint[]

  /** Node the connection is established with. `null` until connected. */
  readonly activeRpcEndpoint: IRpcEndpoint | null
}

/**
 * Session of an unlocked wallet.
 *
 * Lifetime is tightly bound to the lock. The session owns the
 * root key derived from the seed phrase. `close()` must wipe it
 * and drop node connections: otherwise a locked wallet would
 * keep keys in memory and keep polling RPC, disclosing the
 * user's activity to the operator.
 */
export interface IWalletSession {
  getSnapshot(): IWalletSnapshot
  subscribe(listener: () => void): () => void

  /** Derive keys, start services, and load data. */
  open(): Promise<void>

  /** Wipe keys, close connections, and reset the snapshot. */
  close(): Promise<void>

  /**
   * Secret backup: seed phrase and private keys.
   *
   * Available only on an open session. A locked wallet does not
   * hand over the manager: an export screen that stayed usable
   * after auto-lock would void auto-lock itself.
   *
   * @throws NotInitializedError when the session is closed.
   */
  getBackup(): IBackupManager

  selectAccount(id: AccountId): Promise<void>

  createAccount(name?: string): Promise<void>

  /**
   * Find addresses that have already been used and add the missing ones.
   *
   * Needed for a restored wallet: addresses derive from the seed,
   * but the wallet does not know them until it derives them.
   */
  discoverAccounts(): Promise<IAccountDiscoverySummary>

  switchNetwork(chainId: ChainId): Promise<void>

  /**
   * Add a user network.
   *
   * The node is queried before save: a network whose node serves
   * another chain will not enter storage.
   *
   * @throws NetworkImpersonationError if the name matches a
   *         built-in network under a different id. A second call
   *         with `allowImpersonation: true` adds it with the
   *         user's consent.
   * @throws NetworkAlreadyExistsError, InvalidRpcUrlError,
   *         InsecureRpcUrlError, ChainIdMismatchError,
   *         ProviderUnavailableError
   */
  addNetwork(params: IAddNetworkParams): Promise<void>

  /**
   * Remove a user network.
   *
   * Built-in networks cannot be removed: their config is part of
   * impersonation protection.
   *
   * @throws BuiltInNetworkImmutableError, NetworkNotFoundError
   */
  removeNetwork(chainId: ChainId): Promise<void>

  /** Re-fetch the balance, bypassing the cache. */
  refreshBalance(): Promise<void>

  /**
   * Enable or disable background balance polling.
   *
   * Called by the UI layer when the tab leaves and returns.
   * Polling a hidden screen spends node limits and keeps telling
   * its operator that the wallet is open.
   */
  setBackgroundRefreshEnabled(enabled: boolean): void

  /**
   * Add a hardware-wallet account.
   *
   * The address must be confirmed on the device screen before
   * the call: the page loads from a server and may show something
   * other than what the key derived.
   */
  addHardwareAccount(params: IAddHardwareAccountParams): Promise<IAccount>

  /**
   * Run a dapp call on the node before showing confirmation.
   *
   * Returns "could not check" instead of throwing: node
   * unavailability must not stop the user from deciding
   * themselves.
   */
  checkDappRequest(request: IDappRequest): Promise<IPreflightResult>

  refreshHistory(): Promise<void>

  /**
   * Fetch an earlier stretch of history.
   *
   * Does nothing when there is nothing to continue or a request
   * is already in flight: a second press must not start another
   * scan with the same cursor and double the records.
   */
  loadMoreHistory(): Promise<void>

  /**
   * Read contract metadata without adding the token.
   *
   * Needed by the add form: the user must see which token they
   * are adding before confirming.
   *
   * @throws InvalidTokenContractError
   */
  previewToken(address: Address): Promise<ITokenMetadata>

  /**
   * Add a token to the active network.
   *
   * Metadata is read from the contract; the passed decimals are
   * checked against it, and a mismatch is a refusal.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  addToken(
    address: Address,
    symbolOverride?: string,

    /**
     * Consent to add a contract that uses a verified token's
     * name. Without it such an add is rejected.
     */
    allowImpersonation?: boolean,
  ): Promise<void>

  removeToken(address: Address): Promise<void>

  refreshTokens(): Promise<void>

  /**
   * Parse the typed recipient: address or ENS name.
   *
   * Does not throw: the form parses as the user types, and a
   * node failure must become a screen state, not a console
   * error.
   */
  resolveRecipient(input: string): Promise<IRecipientResolution>

  /**
   * Allow a third-party price source and load rates.
   *
   * This is the owner's decision, not a default. A rate request
   * names the contract address and network to the source, i.e.
   * discloses the portfolio. The wallet address is not sent: the
   * service does not know whose portfolio it is.
   */
  enablePrices(): Promise<void>

  /** Revoke consent. Rates stop being requested; the estimate disappears. */
  disablePrices(): Promise<void>

  /** Re-fetch rates, bypassing the cache. */
  refreshPrices(): Promise<void>

  /**
   * Store credentials for a third-party simulation source.
   *
   * Does not grant consent: an entered key means "I am ready",
   * not "start".
   */
  setTenderlyCredentials(credentials: ITenderlyCredentials): Promise<void>

  /** Forget the credentials and drop consent with them. */
  clearTenderlyCredentials(): Promise<void>

  /**
   * Allow a third-party simulation source.
   *
   * This is the owner's decision. The request tells the operator
   * the address, recipient, amount, and call data — i.e. the
   * spend intent, before signing and including transactions the
   * owner will reject.
   */
  enableSimulationSource(): Promise<void>

  /** Revoke consent. Transaction effects are computed by the node again. */
  disableSimulationSource(): Promise<void>

  /**
   * Prepare a transfer for signing and compute fee options.
   *
   * The returned transaction is exactly what will be signed. The
   * confirmation screen must show its fields, not recompute
   * values: a mismatch between what is shown and what is signed
   * is the main class of wallet-UI attacks.
   *
   * @throws GasEstimationFailedError if the call would revert,
   *         InsufficientFundsError if funds do not cover the
   *         transfer plus the fee.
   */
  prepareTransfer(request: ITransactionRequest): Promise<IPreparedTransfer>

  /**
   * Sign and publish a prepared transaction.
   *
   * Accepts the object from `prepareTransfer` that was shown to
   * the user — with no intermediate recalculation.
   *
   * @returns Hash of the published transaction.
   */
  sendTransfer(transaction: ISignableTransaction): Promise<TxHash>

  /**
   * Find approvals issued by the active account.
   *
   * Called by the approvals section on open. A second call
   * re-fetches the list.
   */
  loadApprovals(): Promise<void>

  /**
   * Prepare a revoke of an issued approval.
   *
   * A revoke is an ordinary transaction: it costs gas and needs
   * a signature. It is sent with the same `sendTransfer` as a
   * transfer.
   */
  prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<IPreparedTransfer>

  /**
   * Find collectibles of the active account.
   *
   * Called by the NFT section on open. A second call re-fetches
   * the list: it may have changed since last time.
   */
  loadNfts(): Promise<void>

  /**
   * Prepare an ERC-20 token transfer.
   *
   * The core assembles the call data: recipient and amount live
   * there, not in the transaction fields.
   *
   * @throws InsufficientTokenBalanceError if tokens are less
   *         than the amount.
   */
  prepareTokenTransfer(request: ITokenTransferRequest): Promise<IPreparedTransfer>

  /**
   * Prepare a collectible transfer.
   *
   * @throws NftNotOwnedError if the item does not belong to the
   *         sender.
   */
  prepareNftTransfer(request: INftTransferRequest): Promise<IPreparedTransfer>

  /**
   * Prepare a speed-up of a stuck transaction.
   *
   * Repeats the same operation with the same nonce and a higher
   * fee. The result is sent with ordinary `sendTransfer`: a
   * replacement is the same kind of transaction, and the user
   * must confirm it the same way.
   *
   * @throws TransactionNotReplaceableError if the transaction
   *         is already in a block or its parameters were not
   *         stored.
   */
  prepareSpeedUp(hash: TxHash): Promise<IPreparedTransfer>

  /**
   * Prepare a cancel of a stuck transaction.
   *
   * A sent transaction cannot be cancelled; its nonce can be
   * taken by a zero-value transfer to self. Success is not
   * guaranteed — the original may land in a block first.
   *
   * @throws TransactionNotReplaceableError if the transaction
   *         is already in a block.
   */
  prepareCancel(hash: TxHash): Promise<IPreparedTransfer>

  /**
   * Determine whether an address is a contract.
   *
   * Needed for the warning before send: native currency sent to
   * a contract that does not accept it is lost forever.
   *
   * @returns `null` if the node did not answer. "Could not
   *          check" and "not a contract" are different claims,
   *          and the second shown in place of the first
   *          reassures without grounds.
   */
  isContractRecipient(address: Address): Promise<boolean | null>

  /**
   * Execute a dapp request the user approved.
   *
   * Screens and risk scoring stay above: this method only signs
   * and, if asked, sends. A second place that decides what
   * counts as consent would be a second place to decide it
   * wrongly.
   *
   * @returns A signature or a transaction hash — what the app
   *          expects.
   */
  executeDappRequest(request: IDappRequest): Promise<string>

  /**
   * Check availability of every RPC endpoint of the active network.
   *
   * Makes real connections and measures response time: a node's
   * fitness cannot be judged without talking to it.
   */
  checkRpcHealth(): Promise<readonly IRpcEndpointHealth[]>

  /**
   * Add a custom RPC endpoint for the active network.
   *
   * The node is checked before save: an address that serves
   * another network will not enter storage.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError, ChainIdMismatchError,
   *         ProviderUnavailableError
   */
  addRpcEndpoint(url: string): Promise<void>

  removeRpcEndpoint(url: string): Promise<void>
}
