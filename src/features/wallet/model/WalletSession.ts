import {
  ApprovalService,
  BackupManager,
  BalanceService,
  BUILT_IN_NETWORKS,
  CustomRpcProvider,
  discoverUsedAccounts,
  DEFAULT_CHAIN_ID,
  EnsService,
  ExportAuditLog,
  ExportGuard,
  FailoverProvider,
  HistoryService,
  LogScanHistoryProvider,
  MnemonicService,
  NetworkRepository,
  NetworkService,
  NftService,
  NullPriceProvider,
  PriceService,
  PublicRpcProvider,
  SETTINGS_KEY,
  LazyRpcClientFactory,
  RpcManager,
  STORAGE_NAMESPACE,
  TokenRepository,
  TokenService,
  TransactionRepository,
  TransactionService,
  VAULT_KEY,
  NotInitializedError,
  WalletNotInitializedError,
  DAPP_REQUEST_KIND,
  beautifyEnsName,
  buildPortfolio,
  isContractAddress,
  isValidAddress,
  looksLikeEnsName,
  normalizeEnsName,
  toAddress,
  toWei,
  type AccountId,
  type AccountManager,
  type Address,
  type ChainId,
  type IAccount,
  type IAddNetworkParams,
  type IBackupManager,
  type IClock,
  type IDappRequest,
  type IEnsResolution,
  type HDWalletService,
  type IHistoryProvider,
  type ILogger,
  type INetworkConfig,
  type IPriceProvider,
  type IProviderFactory,
  type IRpcEndpointHealth,
  type IRpcProvider,
  type ISecureStorage,
  type IStorageService,
  type ISignableTransaction,
  type INftTransferRequest,
  type IRevokeApprovalRequest,
  type ITokenMetadata,
  type ITokenTransferRequest,
  type ITransferRecord,
  type HexString,
  type IAddHardwareAccountParams,
  type IHardwareDevice,
  type IPreflightRequest,
  type IPreflightResult,
  type ISimulationResult,
  type ITenderlyCredentials,
  PREFLIGHT_OUTCOME,
  preflightCall,
  SimulationService,
  TenderlySimulationProvider,
  simulateTransaction,
  UNCHECKED_SIMULATION,
  type ITransactionRequest,
  type TxHash,
  type Unsubscribe,
} from '@/core'

import {
  RECIPIENT_STATUS,
  SESSION_STATE,
  type IPreparedTransfer,
  type IRecipientResolution,
  type IAccountDiscoverySummary,
  type ITokenBalance,
  type IWalletSession,
  type IWalletSnapshot,
} from './contracts'

const SESSION_NAME = 'WalletSession'

/**
 * Empty ENS name map.
 *
 * One instance for the whole app: `useSyncExternalStore` compares the
 * snapshot by reference, and a new empty map on every publish would
 * re-render with no data change.
 */
const EMPTY_ENS_NAMES: ReadonlyMap<string, string> = new Map()

/** Result of a trial that was not run. A constant so the reference stays stable. */
const UNCHECKED_PREFLIGHT: IPreflightResult = {
  outcome: PREFLIGHT_OUTCOME.Unavailable,
  reason: null,
  revertData: null,
}

/** Closed-session snapshot. One instance: recreating it would re-render. */
const CLOSED_SNAPSHOT: IWalletSnapshot = {
  state: SESSION_STATE.Closed,
  error: null,
  accounts: [],
  activeAccount: null,
  networks: [],
  activeNetwork: null,
  balance: null,
  balanceError: null,
  isBalanceLoading: false,
  transfers: [],
  historyLimits: null,
  historyCursor: null,
  isHistoryLoading: false,
  isHistoryLoadingMore: false,
  tokenBalances: [],
  isTokensLoading: false,
  nfts: null,
  nftLimits: null,
  isNftLoading: false,
  approvals: null,
  approvalLimits: null,
  isApprovalsLoading: false,
  portfolio: null,
  arePricesEnabled: false,
  isPortfolioLoading: false,
  priceError: null,
  priceSourceName: '',
  isTenderlyConfigured: false,
  isSimulationSourceEnabled: false,
  simulationSourceName: null,
  ensNames: EMPTY_ENS_NAMES,
  isEnsSupported: false,
  rpcEndpoints: [],
  activeRpcEndpoint: null,
}

/** Session dependencies. */
export interface IWalletSessionDependencies {
  /** The same decryption session as onboarding. */
  readonly secureStorage: ISecureStorage

  /** Unencrypted storage — for network configs. */
  readonly storage: IStorageService

  readonly clock: IClock
  readonly logger: ILogger

  /**
   * Node-connection factory.
   *
   * Test seam. Without it a session test would hit real public RPCs:
   * the test becomes slow and depends on the network and someone
   * else's uptime.
   */
  readonly providerFactory?: IProviderFactory

  /**
   * RPC endpoint sources in preference order.
   *
   * Set from outside: the set of sources and their priority is app
   * policy, not a session property. The custom-URL source is added
   * here automatically if missing — without it add/remove of an own
   * node would not work.
   *
   * Default is the public source. Alchemy is not included: it needs
   * a key, and the key is read from the environment by the app layer
   * and is not passed into the core.
   */
  readonly rpcProviders?: readonly IRpcProvider[]

  /**
   * Transfer-history sources in preference order.
   *
   * Default is log-scan only: it works everywhere, needs no key, and
   * does not send the user's address to a third party. An indexer is
   * added by the app layer because "completeness for privacy" is the
   * owner's decision, not the core's.
   */
  readonly historyProviders?: readonly IHistoryProvider[]

  /** Connect a hardware wallet on demand. */
  readonly connectHardware?: () => Promise<IHardwareDevice>

  /**
   * Price source.
   *
   * Default is a source that knows no prices. That is not a stub:
   * until the user consents to a third-party call, the wallet does
   * not fetch rates. The live source is injected by the app layer
   * because "a valuation in exchange for revealing the portfolio" is
   * the owner's decision, not the core's.
   */
  readonly priceProvider?: IPriceProvider

  /**
   * Tenderly credentials from the build environment.
   *
   * Read by the app layer, not the core. `import.meta.env` is a
   * bundler feature; the core must not know about it — it has to
   * build in the extension and in tests, where there is no
   * `import.meta`.
   *
   * This is the local-check path. A `.env` value lands in the shipped
   * program text and is available to anyone who opens it, so
   * owner-entered credentials override it.
   */
  readonly tenderlyCredentials?: ITenderlyCredentials | null
}

/**
 * Services of an unlocked wallet.
 *
 * Why a separate object, not assembly in a component. The services
 * share a lifetime: `HDWalletService` holds the root key,
 * `RpcManager` open connections, `BalanceService` poll timers.
 * Spread across React components they would outlive a lock: tree
 * unmount is not guaranteed, and `useEffect` cleanup does not always
 * run in the order keys must be wiped.
 *
 * Close order matters. Stop polling first, then drop connections,
 * then wipe the root key. The reverse would leave a running timer
 * calling destroyed services.
 */
export class WalletSession implements IWalletSession {
  readonly #secureStorage: ISecureStorage
  readonly #storage: IStorageService
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #providerFactory: IProviderFactory
  readonly #customRpc: CustomRpcProvider
  readonly #rpcProviders: readonly IRpcProvider[]
  readonly #historyProviders: readonly IHistoryProvider[]

  /**
   * Hardware-wallet connection.
   *
   * Injected from outside: WebHID exists only in the browser, and the
   * session need not know about it. Missing means a build without
   * device support.
   */
  readonly #connectHardware: (() => Promise<IHardwareDevice>) | null
  readonly #priceProvider: IPriceProvider

  /** Tenderly credentials from the build environment. `null` means none. */
  readonly #buildCredentials: ITenderlyCredentials | null

  /* Simulation service is rebuilt when credentials or consent
     change: the source set is fixed in the constructor. */
  #simulation: SimulationService | null = null
  readonly #listeners = new Set<() => void>()

  /* One instance per session: the service holds no state, and
     creating it in every method that needs it would multiply
     identical objects for no reason. */
  readonly #mnemonicService = new MnemonicService()

  #snapshot: IWalletSnapshot = CLOSED_SNAPSHOT

  #hdWallet: HDWalletService | null = null
  #accounts: AccountManager | null = null
  #networks: NetworkService | null = null
  #providers: RpcManager | null = null
  #balances: BalanceService | null = null
  #transactions: TransactionRepository | null = null
  #history: HistoryService | null = null
  #tokens: TokenService | null = null
  #nfts: NftService | null = null
  #approvals: ApprovalService | null = null
  #transactionService: TransactionService | null = null
  #prices: PriceService | null = null
  #backup: BackupManager | null = null
  #ens: EnsService | null = null

  #unsubscribeBalance: Unsubscribe | null = null
  #unsubscribeBalanceEvents: Unsubscribe | null = null
  #unsubscribeTransactionEvents: Unsubscribe | null = null

  /* Background polling is on while the tab is visible. The UI layer
     drives it: `document.visibilityState` is DOM, and the session
     must run in the extension service worker, where there is no
     document. */
  #isBackgroundRefreshEnabled = true

  /* Re-entry guard: the screen may call open() twice — for example
     on a fast unlock-state change. */
  #opening: Promise<void> | null = null

  constructor(dependencies: IWalletSessionDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#storage = dependencies.storage
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SESSION_NAME)
    this.#providerFactory =
      dependencies.providerFactory ?? new LazyRpcClientFactory({ logger: dependencies.logger })

    /* The default set includes the public source. Without it a
       session built with no explicit list would get no URL and
       connect nowhere: Alchemy needs a key, and the key lives in
       the app layer and never reaches the core. */
    const configured = dependencies.rpcProviders ?? [new PublicRpcProvider()]
    const existingCustom = configured.find(
      (provider): provider is CustomRpcProvider => provider instanceof CustomRpcProvider,
    )

    this.#customRpc = existingCustom ?? new CustomRpcProvider(dependencies.secureStorage)

    /* The user's own node goes first: it was chosen on purpose, and
       substituting the default would undo the owner's decision. */
    this.#rpcProviders =
      existingCustom === undefined ? [this.#customRpc, ...configured] : configured

    this.#historyProviders = dependencies.historyProviders ?? [new LogScanHistoryProvider()]
    this.#connectHardware = dependencies.connectHardware ?? null
    this.#priceProvider = dependencies.priceProvider ?? new NullPriceProvider()
    this.#buildCredentials = dependencies.tenderlyCredentials ?? null
  }

  getSnapshot(): IWalletSnapshot {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  async open(): Promise<void> {
    if (this.#snapshot.state === SESSION_STATE.Open) {
      return
    }

    this.#opening ??= this.#openOnce()

    try {
      await this.#opening
    } finally {
      this.#opening = null
    }
  }

  async close(): Promise<void> {
    this.#unsubscribeBalance?.()
    this.#unsubscribeBalance = null

    this.#unsubscribeBalanceEvents?.()
    this.#unsubscribeBalanceEvents = null

    this.#unsubscribeTransactionEvents?.()
    this.#unsubscribeTransactionEvents = null

    /* Watching stops with the session: a timer that outlived lock
       would keep polling the node and tell the operator that a
       wallet with these addresses exists. */
    this.#transactionService?.stopTracking()

    this.#balances?.stop()
    await this.#providers?.destroy()

    /* Caches are cleared BEFORE the references are nulled: after
       that there is nobody to call. Collection names and token
       metadata are not secret, but the link "this wallet looked at
       these contracts" must not outlive lock — same reason as the
       name cache. */
    this.#nfts?.clear()
    this.#approvals?.clear()

    /* Wiping the root key is the last action and the one this
       whole order exists for. */
    this.#hdWallet?.wipe()

    this.#hdWallet = null
    this.#accounts = null
    this.#networks = null
    this.#providers = null
    this.#balances = null
    this.#transactions = null
    this.#history = null
    this.#tokens = null
    this.#nfts = null
    this.#approvals = null
    this.#transactionService = null
    this.#prices = null
    this.#backup = null

    /* The name cache is dropped with the session: it links wallet
       addresses to names, and that link must not outlive lock. */
    this.#ens?.clearCache()
    this.#ens = null

    this.#publish(CLOSED_SNAPSHOT)
  }

  /**
   * Returns the backup manager.
   *
   * Why a sub-service, not five wrapper methods. The session is
   * already large, and five delegating methods would add no check —
   * only five places for signatures to drift. Secret export stays
   * bound to the session lifetime: a locked wallet does not hand
   * the manager out at all.
   *
   * @throws NotInitializedError when the session is closed.
   */
  getBackup(): IBackupManager {
    if (this.#backup === null) {
      throw new NotInitializedError(SESSION_NAME)
    }

    return this.#backup
  }

  /**
   * Enable or disable background balance polling.
   *
   * Why disable. Polling a hidden tab spends node quota and — more
   * important — keeps telling the operator that a wallet with this
   * address is open while the user is busy elsewhere. There is
   * nothing to refresh on an unseen screen.
   *
   * Returning to the tab refreshes immediately, not after the poll
   * period: the shown balance is already stale by then.
   *
   * Called by the UI layer: `document.visibilityState` is DOM, and
   * the core and session must run where there is no document.
   */
  setBackgroundRefreshEnabled(enabled: boolean): void {
    if (this.#isBackgroundRefreshEnabled === enabled) {
      return
    }

    this.#isBackgroundRefreshEnabled = enabled

    if (this.#snapshot.state !== SESSION_STATE.Open) {
      return
    }

    this.#resubscribeBalance(this.#snapshot.activeAccount, this.#snapshot.activeNetwork)

    if (enabled) {
      void this.refreshBalance()
    }
  }

  async selectAccount(id: AccountId): Promise<void> {
    await this.#requireAccounts().setActive(id)
    await this.#reloadAccountScopedData()
  }

  async createAccount(name?: string): Promise<void> {
    await this.#requireAccounts().create(name === undefined ? {} : { name })

    this.#publish({ ...this.#snapshot, accounts: this.#requireAccounts().listVisible() })
  }

  async switchNetwork(chainId: ChainId): Promise<void> {
    const networks = this.#requireNetworks()

    await networks.switchTo(chainId)

    /* The balance cache is keyed by (address, chain), but the shown
       value belongs to the previous chain. Leaving it on screen
       would show one chain's balance under another chain's name. */
    this.#balances?.invalidate()

    this.#publish({
      ...this.#snapshot,
      networks: networks.list(),
      activeNetwork: networks.getActive(),
      balance: null,
      balanceError: null,
      activeRpcEndpoint: null,
    })

    await this.#reloadAccountScopedData()
  }

  async refreshBalance(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#balances === null) {
      return
    }

    this.#publish({ ...this.#snapshot, isBalanceLoading: true, balanceError: null })

    try {
      const balances = await this.#balances.refresh(account.address, network.chainId)

      this.#publish({
        ...this.#snapshot,
        balance: balances.native,
        isBalanceLoading: false,
      })
    } catch (error) {
      this.#publishBalanceFailure(error)
    }
  }

  async addNetwork(params: IAddNetworkParams): Promise<void> {
    await this.#requireNetworks().add(params)

    /* The network list is published at once, without reloading
       account data: adding a network does not make it active, so
       there is no need to touch balance or history. */
    this.#publish({ ...this.#snapshot, networks: this.#requireNetworks().list() })
  }

  async removeNetwork(chainId: ChainId): Promise<void> {
    const networks = this.#requireNetworks()
    const wasActive = this.#snapshot.activeNetwork?.chainId === chainId

    await networks.remove(chainId)

    /* The connection to the removed network is closed: left open it
       would keep polling a node that is no longer in the list. */
    await this.#requireProviders().release(chainId)

    this.#publish({
      ...this.#snapshot,
      networks: networks.list(),
      activeNetwork: networks.getActive(),
    })

    /* Removing the active network moves the wallet to the default
       chain, and all chain-bound data — balance, history, node list —
       must be re-read. */
    if (wasActive) {
      this.#balances?.invalidate()
      await this.#reloadAccountScopedData()
    }
  }

  async refreshHistory(): Promise<void> {
    this.#publish({ ...this.#snapshot, isHistoryLoading: true })

    await this.#loadHistory(this.#snapshot.activeAccount, this.#snapshot.activeNetwork)
  }

  /**
   * Loads an earlier slice of history.
   *
   * Exactly one request. A second click while the first is unfinished
   * would leave with the same cursor and return the same slice;
   * records would be de-duped by key, but the node would be polled
   * twice and the operator would see the address again.
   */
  async loadMoreHistory(): Promise<void> {
    const cursor = this.#snapshot.historyCursor
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (
      cursor === null ||
      account === null ||
      network === null ||
      this.#history === null ||
      this.#snapshot.isHistoryLoadingMore
    ) {
      return
    }

    this.#publish({ ...this.#snapshot, isHistoryLoadingMore: true })

    try {
      const page = await this.#history.getHistory(account.address, network.chainId, { cursor })

      /* The active account or network may have changed while the
         node answered. Appending the result to someone else's
         history would show another address's operations as ours. */
      if (
        this.#snapshot.activeAccount?.id !== account.id ||
        this.#snapshot.activeNetwork?.chainId !== network.chainId
      ) {
        return
      }

      this.#publish({
        ...this.#snapshot,
        transfers: appendTransfers(
          this.#snapshot.transfers,
          this.#withKnownAssets(page.transfers, network.chainId),
        ),
        historyLimits: page.limits,
        historyCursor: page.cursor,
        isHistoryLoadingMore: false,
      })
    } catch (error) {
      this.#logger.warn('The earlier part of the history is unavailable', {
        reason: error instanceof Error ? error.message : String(error),
      })

      /* The cursor is kept: a node refusal is not the end of
         history, and a retry must start from the same place. */
      this.#publish({ ...this.#snapshot, isHistoryLoadingMore: false })
    }
  }

  async previewToken(address: Address): Promise<ITokenMetadata> {
    const network = this.#requireActiveNetwork()

    return await this.#requireTokens().fetchMetadata(network.chainId, address)
  }

  async addToken(
    address: Address,
    symbolOverride?: string,
    allowImpersonation?: boolean,
  ): Promise<void> {
    const network = this.#requireActiveNetwork()

    await this.#requireTokens().add({
      chainId: network.chainId,
      address,
      ...(symbolOverride === undefined ? {} : { symbol: symbolOverride }),
      ...(allowImpersonation === true ? { allowImpersonation: true } : {}),
    })

    await this.refreshTokens()
  }

  async removeToken(address: Address): Promise<void> {
    const network = this.#requireActiveNetwork()

    await this.#requireTokens().remove({ chainId: network.chainId, address })
    await this.refreshTokens()
  }

  async refreshTokens(): Promise<void> {
    this.#publish({ ...this.#snapshot, isTokensLoading: true })

    await this.#loadTokens(this.#snapshot.activeAccount, this.#snapshot.activeNetwork)
    await this.#loadPortfolio()
  }

  /**
   * Parse the typed recipient.
   *
   * Checks run cheap-to-expensive: empty, address, not-a-name — all
   * without a network call. The node is asked only where there is no
   * other way.
   *
   * Does not throw. Parsing runs as the user types, and a node
   * refusal must become on-screen state: "could not check" is what
   * the user should read, not what should hit the console.
   */
  async resolveRecipient(input: string): Promise<IRecipientResolution> {
    const value = input.trim()

    if (value === '') {
      return { status: RECIPIENT_STATUS.Empty, address: null, name: null, isAscii: true }
    }

    if (isValidAddress(value)) {
      const address = toAddress(value)

      const named = await this.#lookupNameQuietly(address)

      return {
        status: RECIPIENT_STATUS.Address,
        address,
        name: named?.displayName ?? null,
        isAscii: named?.isAscii ?? true,
      }
    }

    if (!looksLikeEnsName(value)) {
      return { status: RECIPIENT_STATUS.Invalid, address: null, name: null, isAscii: true }
    }

    const ens = this.#ens
    const network = this.#snapshot.activeNetwork

    if (ens === null || network === null || !ens.isSupported(network.chainId)) {
      return { status: RECIPIENT_STATUS.EnsUnavailable, address: null, name: null, isAscii: true }
    }

    const normalized = normalizeEnsName(value)

    if (normalized === null) {
      return { status: RECIPIENT_STATUS.NameUnsupported, address: null, name: null, isAscii: true }
    }

    try {
      const resolution = await ens.resolveName(normalized)

      return resolution === null
        ? {
            status: RECIPIENT_STATUS.NameNotFound,
            address: null,
            name: beautifyEnsName(normalized),
            isAscii: true,
          }
        : {
            status: RECIPIENT_STATUS.NameResolved,
            address: resolution.address,
            name: resolution.displayName,
            isAscii: resolution.isAscii,
          }
    } catch (error) {
      this.#logger.warn('The ENS name could not be resolved', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return {
        status: RECIPIENT_STATUS.Failed,
        address: null,
        name: beautifyEnsName(normalized),
        isAscii: true,
      }
    }
  }

  /**
   * Reverse-resolve an address without blocking input.
   *
   * A node refusal leaves the label empty: the address is already
   * known and sendable; the name is only decoration.
   */
  async #lookupNameQuietly(address: Address): Promise<IEnsResolution | null> {
    try {
      return (await this.#ens?.lookupAddress(address)) ?? null
    } catch {
      return null
    }
  }

  async enablePrices(): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.PricesEnabled, true)

    this.#publish({ ...this.#snapshot, arePricesEnabled: true })

    await this.#loadPortfolio()
  }

  async disablePrices(): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.PricesEnabled, false)

    /* The cache is cleared with consent withdrawal: leaving rates
       fetched under the previous permission would keep showing an
       estimate after it was refused. */
    this.#prices?.invalidate()

    this.#publish({
      ...this.#snapshot,
      arePricesEnabled: false,
      portfolio: null,
      priceError: null,
      isPortfolioLoading: false,
    })
  }

  /**
   * Save Tenderly credentials.
   *
   * Does not grant consent. A typed key means "I am ready", not
   * "start": enabling stays a separate action with a list of what
   * leaves. Entering data and allowing its use are different
   * decisions; merging them would take the second under the guise of
   * the first.
   */
  async setTenderlyCredentials(credentials: ITenderlyCredentials): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.TenderlyAccount,
      credentials.account.trim(),
    )
    await this.#storage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.TenderlyProject,
      credentials.project.trim(),
    )
    await this.#storage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.TenderlyAccessKey,
      credentials.accessKey.trim(),
    )

    await this.#refreshSimulation()
  }

  /** Forget credentials and switch the source off with them. */
  async clearTenderlyCredentials(): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyAccount)
    await this.#storage.remove(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyProject)
    await this.#storage.remove(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyAccessKey)

    /* Consent is lifted with the data: leaving it would let the next
       typed key start silently, without a new decision. */
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.SimulationSourceEnabled, false)

    await this.#refreshSimulation()
  }

  async enableSimulationSource(): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.SimulationSourceEnabled, true)

    await this.#refreshSimulation()
  }

  async disableSimulationSource(): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.SimulationSourceEnabled, false)

    await this.#refreshSimulation()
  }

  async refreshPrices(): Promise<void> {
    this.#prices?.invalidate()

    await this.#loadPortfolio()
  }

  /**
   * Prepare a transfer for signing.
   *
   * Recipient remarks are not computed here. Some of them —
   * especially a missing checksum — are visible only from how the
   * user typed the address, and `prepare` works with a normalized
   * value. Computing them from the normalized form would never find
   * them, so the check lives where the raw input is — the send
   * screen.
   */
  async prepareTransfer(request: ITransactionRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepare(request))
  }

  /**
   * Sign and publish a transfer.
   *
   * The object passed in is what is signed. Recalculating fields
   * between display and sign would diverge what the person confirmed
   * from what went on-chain.
   *
   * The account is taken from `from`, not from the active account:
   * between prepare and confirm the user may have switched, and
   * signing with another key would send funds from the wrong
   * address. `SigningService` would reject that swap too, but
   * relying on the last line instead of an explicit choice is
   * wrong.
   */
  async sendTransfer(transaction: ISignableTransaction): Promise<TxHash> {
    const accounts = this.#requireAccounts()
    const sender = accounts.getByAddress(transaction.from)

    if (sender === null) {
      throw new Error('The sender does not belong to this wallet.')
    }

    const signed = await accounts.signTransaction(sender.id, transaction)
    const hash = await this.#requireTransactions().send(signed)

    /* History and balance are re-read: the sent tx must appear in
       the list at once, or the user will think the send failed. */
    this.#balances?.invalidate()
    await this.#reloadAccountScopedData()

    return hash
  }

  /**
   * Find addresses already used and add the missing ones.
   *
   * Started by the owner. Discovery tells the node operator two
   * dozen addresses at once and links them; doing that unasked on
   * every launch would leak more than needed. Exception: first open
   * of a restored wallet — the cost of silence is higher, and
   * discovery runs itself, once.
   *
   * @returns How many accounts were added.
   */
  async discoverAccounts(): Promise<IAccountDiscoverySummary> {
    const accounts = this.#requireAccounts()
    const hdWallet = this.#hdWallet

    /* The network comes from the service, not the snapshot: on
       first open discovery runs before the snapshot is filled, and
       from the snapshot it would silently find nothing. */
    const network = this.#networks?.getActive() ?? null

    if (network === null || hdWallet === null || this.#providers === null) {
      return { added: 0, scanned: 0, stoppedByLimit: false }
    }

    const provider = await this.#providers.get(network)

    const result = await discoverUsedAccounts(
      provider,
      (addressIndex: number) => hdWallet.getAddress(addressIndex),
      this.#logger,
    )

    /* Hitting the cap means the node is answering unreliably.
       Every checked address came back used in a row, which a live
       wallet does not do: that looks like a lying node or a fault.
       Creating two hundred accounts from that reply would junk the
       wallet with undeletable HD accounts (they can only be hidden). */
    if (result.stoppedByLimit) {
      this.#logger.warn(
        'Account discovery stopped at the limit: the node answers for every address',
      )

      return { added: 0, scanned: result.scanned, stoppedByLimit: true }
    }

    /* Addresses that already exist are skipped: discovery is
       repeated, account creation is not. */
    const known = new Set(accounts.list().map((account) => account.address.toLowerCase()))

    let added = 0

    for (const addressIndex of result.usedIndexes) {
      if (known.has(hdWallet.getAddress(addressIndex).toLowerCase())) {
        continue
      }

      await accounts.create({ addressIndex })
      added += 1
    }

    if (added > 0) {
      this.#publish({ ...this.#snapshot, accounts: accounts.listVisible() })
    }

    return { added, scanned: result.scanned, stoppedByLimit: result.stoppedByLimit }
  }

  /**
   * Run discovery once in the wallet's life.
   *
   * Failure does not block session open: a one-account wallet is
   * usable, and discovery can be retried from the settings button.
   */
  async #discoverAccountsOnce(): Promise<void> {
    const done = await this.#storage.get<boolean>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.AccountsDiscovered,
    )

    if (done === true) {
      return
    }

    try {
      await this.discoverAccounts()
    } catch (error) {
      this.#logger.warn('Account discovery failed', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return
    }

    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.AccountsDiscovered, true)
  }

  /**
   * Find approvals granted by the active account.
   *
   * On demand only — same as item discovery: this is a log scan and
   * a call to every found contract.
   */
  async loadApprovals(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#approvals === null) {
      return
    }

    this.#publish({ ...this.#snapshot, isApprovalsLoading: true })

    const page = await this.#approvals.list(account.address, network.chainId)

    /* The reply is applied only if account and network did not
       change: someone else's approval list under a new address
       would reassure the owner without grounds. */
    if (
      this.#snapshot.activeAccount?.id !== account.id ||
      this.#snapshot.activeNetwork?.chainId !== network.chainId
    ) {
      return
    }

    this.#publish({
      ...this.#snapshot,
      approvals: page.items,
      approvalLimits: page.limits,
      isApprovalsLoading: false,
    })
  }

  /** Prepare a revoke of a granted approval. */
  async prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareRevokeApproval(request),
    )
  }

  /**
   * Find collectibles of the active account.
   *
   * On demand only. Discovery is a log scan and a call to every
   * found contract: dozens of requests and a detailed trail at the
   * node operator. Doing it on every wallet entry would pay for
   * something the owner did not ask for.
   */
  async loadNfts(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#nfts === null) {
      return
    }

    this.#publish({ ...this.#snapshot, isNftLoading: true })

    const page = await this.#nfts.list(account.address, network.chainId)

    /* The reply is applied only if account and network did not
       change during the search: someone else's list under a new
       address reads as someone else's property. */
    if (
      this.#snapshot.activeAccount?.id !== account.id ||
      this.#snapshot.activeNetwork?.chainId !== network.chainId
    ) {
      return
    }

    this.#publish({
      ...this.#snapshot,
      nfts: page.items,
      nftLimits: page.limits,
      isNftLoading: false,
    })
  }

  /**
   * Prepare an ERC-20 transfer for signing.
   *
   * A separate method, not a flag on `prepareTransfer`. On a token
   * transfer the signed `to` is the contract, and the recipient and
   * amount live in the call data. One shape for two operations
   * eventually makes people take the contract address for a person's.
   */
  async prepareTokenTransfer(request: ITokenTransferRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareTokenTransfer(request),
    )
  }

  /**
   * Prepare a collectible transfer for signing.
   *
   * As with a token, the transaction is addressed to the contract
   * and the recipient lives in the call data. Confirm shows both
   * addresses.
   */
  async prepareNftTransfer(request: INftTransferRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareNftTransfer(request),
    )
  }

  /**
   * Prepare a speed-up of a stuck transaction.
   *
   * Sent via ordinary `sendTransfer`. A replace is the same signed,
   * fee-paying transaction; a separate send path would be a second
   * place deciding what to sign, and user confirm could be skipped.
   */
  async prepareSpeedUp(hash: TxHash): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepareSpeedUp(hash))
  }

  /** Prepare a cancel of a stuck transaction. */
  async prepareCancel(hash: TxHash): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepareCancel(hash))
  }

  /**
   * Decide whether an address is a contract.
   *
   * The request runs once, at confirm, not while typing: a check on
   * every keystroke would mean a node request per character.
   */
  async isContractRecipient(address: Address): Promise<boolean | null> {
    const network = this.#snapshot.activeNetwork

    if (network === null || this.#providers === null) {
      return null
    }

    try {
      return await isContractAddress(address, await this.#providers.get(network))
    } catch {
      /* An unavailable node is "could not check", not "ordinary
         address". The second would reassure without grounds. */
      return null
    }
  }

  /**
   * Execute a request the user approved.
   *
   * Called only after confirm. The method shows no screens and
   * assesses no risk: that was done above, and repeating it here
   * would make two places decide what counts as consent.
   *
   * The sender is re-checked. The check ran at accept, but between
   * accept and confirm the user may have switched accounts; there
   * is nothing to sign with a foreign address, and that must be
   * known before sign.
   *
   * @returns A signature or a transaction hash — what the dapp expects.
   */
  async executeDappRequest(request: IDappRequest): Promise<string> {
    const accounts = this.#requireAccounts()
    const payload = request.payload

    if (
      payload.kind === DAPP_REQUEST_KIND.SignMessage ||
      payload.kind === DAPP_REQUEST_KIND.SignTypedData
    ) {
      const account = accounts.getByAddress(payload.address)

      if (account === null) {
        throw new Error('The request targets an account that does not exist in this wallet.')
      }

      return payload.kind === DAPP_REQUEST_KIND.SignMessage
        ? await accounts.signMessage(account.id, payload.message)
        : await accounts.signTypedData(account.id, payload.typedData, request.chainId)
    }

    const sender = accounts.getByAddress(payload.transaction.from)

    if (sender === null) {
      throw new Error('The request targets an account that does not exist in this wallet.')
    }

    /* The transaction goes through the same prepare as a wallet
       send: gas estimate, funds check, type choice. A second path
       to sign would be a second place those checks can be forgotten. */
    const prepared = await this.#requireTransactions().prepare({
      chainId: request.chainId,
      from: payload.transaction.from,
      /* The recipient is passed as sent, including its absence.
         An empty field means a contract deploy, and confirm says so
         plainly. The sender address used to be substituted here: the
         user approved creating a contract and signed a self-transfer
         with bytecode in the call data — gas was spent, the approved
         operation did not run. */
      to: payload.transaction.to,
      value: toWei(payload.transaction.value),
      ...(payload.transaction.data === null ? {} : { data: payload.transaction.data }),
    })

    const signed = await accounts.signTransaction(sender.id, prepared)

    if (payload.kind === DAPP_REQUEST_KIND.SignTransaction) {
      /* The dapp asked to sign, not to send: publishing here would
         be an action the user was not asked about. */
      return signed.raw
    }

    const hash = await this.#requireTransactions().send(signed)

    this.#balances?.invalidate()
    await this.#reloadAccountScopedData()

    return hash
  }

  #requireTransactions(): TransactionService {
    if (this.#transactionService === null) {
      throw new Error('The wallet session is closed.')
    }

    return this.#transactionService
  }

  async checkRpcHealth(): Promise<readonly IRpcEndpointHealth[]> {
    const network = this.#snapshot.activeNetwork

    if (network === null || this.#providers === null) {
      return []
    }

    return await this.#providers.checkHealth(network)
  }

  async addRpcEndpoint(url: string): Promise<void> {
    const network = this.#requireActiveNetwork()

    await this.#requireProviders().addCustomEndpoint(network, url)
    await this.#reloadAccountScopedData()
  }

  async removeRpcEndpoint(url: string): Promise<void> {
    const network = this.#requireActiveNetwork()

    await this.#requireProviders().removeCustomEndpoint(network, url)
    await this.#reloadAccountScopedData()
  }

  async #openOnce(): Promise<void> {
    this.#publish({ ...CLOSED_SNAPSHOT, state: SESSION_STATE.Opening })

    try {
      await this.#buildServices()

      /* Consent is read before data load: otherwise the first load
         would run without rates, and the estimate would appear only
         on the second. */
      await this.#buildSimulation()

      this.#publish({
        ...this.#snapshot,
        arePricesEnabled: await this.#readPricesConsent(),
        priceSourceName: this.#priceProvider.name,
        isSimulationSourceEnabled: await this.#readSimulationConsent(),
        isTenderlyConfigured: (await this.#readTenderlyCredentials()) !== null,
        simulationSourceName: this.#simulation?.activeSourceName() ?? null,
      })

      await this.#reloadAccountScopedData()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      this.#logger.error('The wallet session could not be opened', { reason: message })

      /* Partially built services must be torn down: otherwise a
         derived root key would stay in memory with the session
         unopened. */
      await this.close()
      this.#publish({ ...CLOSED_SNAPSHOT, state: SESSION_STATE.Failed, error: message })
    }
  }

  /** Derive keys and stand the services up. */
  async #buildServices(): Promise<void> {
    /* Signing and HD-tree modules are loaded here, not statically.
       They pull ethers — the heaviest app dependency, which welcome,
       create-wallet, and unlock screens do not need. Load time
       matches when the services are actually needed: the session
       opens after the password. Assembly order and key lifetime do
       not change. */
    const { AccountManager } = await import('@/core/account')

    this.#hdWallet = await this.#deriveHdWallet()

    this.#providers = new RpcManager({
      providers: this.#rpcProviders,
      factory: this.#providerFactory,
      clock: this.#clock,
      logger: this.#logger,
    })

    this.#networks = new NetworkService({
      /* Networks are stored encrypted: a custom network's `rpcUrls`
         hold its node URL, usually with an account key in the
         string. Open storage is passed second: records from older
         versions are migrated from it. */
      repository: new NetworkRepository(this.#secureStorage, this.#storage),
      providerFactory: this.#providerFactory,
      logger: this.#logger,
      builtInNetworks: BUILT_IN_NETWORKS,
      defaultChainId: DEFAULT_CHAIN_ID,
    })

    await this.#networks.init()

    /* Custom URLs are read after the network list: they are stored
       by chainId, and the network list is needed to know what to
       read. */
    await this.#customRpc.init(this.#networks.list())

    this.#accounts = AccountManager.create({
      hdWallet: this.#hdWallet,
      secureStorage: this.#secureStorage,
      clock: this.#clock,
      logger: this.#logger,
      ...(this.#connectHardware === null ? {} : { connectHardware: this.#connectHardware }),
    })

    await this.#accounts.init()

    /* A wallet just created from a seed has no accounts: onboarding
       saves the phrase but does not derive addresses. Without the
       first account the screen would show an empty list and no way
       to fill it. */
    if (this.#accounts.list().length === 0) {
      /* The first account is named from the email if the owner
         provided one: "Account 1" says nothing to someone with
         several wallets. Later accounts are numbered as before —
         they belong to the same owner and an identical label would
         not distinguish them. */
      const username = await this.#readUserName()

      await this.#accounts.create(username === null ? {} : { name: username })
    }

    /* A restored wallet must find its accounts. Addresses are
       derived from the phrase, but the wallet does not know them
       until it derives: someone who had five would see four missing
       and an empty wallet instead of their funds.

       Discovery does not block open. That is two dozen request
       pairs to the node; waiting on the critical path would make
       the wallet take a minute on a slow network. Finds are added
       to the list as they arrive. */
    void this.#discoverAccountsOnce()

    this.#transactions = new TransactionRepository(this.#secureStorage)

    this.#transactionService = new TransactionService({
      resolver: this.#providers,
      networks: this.#networks,
      repository: this.#transactions,
      clock: this.#clock,
      logger: this.#logger,
    })

    this.#history = new HistoryService({
      providers: this.#historyProviders,
      resolver: this.#providers,
      networks: this.#networks,
      logger: this.#logger,
      localRepository: this.#transactions,
    })

    this.#tokens = new TokenService({
      repository: new TokenRepository(this.#secureStorage),
      resolver: this.#providers,
      networks: this.#networks,
      clock: this.#clock,
      logger: this.#logger,
    })

    /* The token list is read after networks are initialized: it is
       stored by chainId, and the network list is needed to know
       what to read. */
    await this.#tokens.init()

    this.#nfts = new NftService({
      resolver: this.#providers,
      networks: this.#networks,
      logger: this.#logger,
    })

    this.#approvals = new ApprovalService({
      resolver: this.#providers,
      networks: this.#networks,
      logger: this.#logger,
    })

    this.#balances = new BalanceService({
      providers: this.#providers,
      networks: this.#networks,
      tokens: this.#tokens,
      clock: this.#clock,
      logger: this.#logger,
    })

    this.#prices = new PriceService({
      provider: this.#priceProvider,
      clock: this.#clock,
      logger: this.#logger,
    })

    this.#ens = new EnsService({
      resolver: this.#providers,
      networks: this.#networks,
      clock: this.#clock,
      logger: this.#logger,
    })

    /* The export log lives in encrypted storage. It holds no
       secrets, but it tells an observer with disk access that the
       owner exported the seed and when. */
    this.#backup = new BackupManager({
      secureStorage: this.#secureStorage,
      mnemonicService: this.#mnemonicService,
      exportGuard: new ExportGuard(new ExportAuditLog(this.#secureStorage), this.#clock),
      accounts: this.#accounts,
      hdWallet: this.#hdWallet,
      logger: this.#logger,
    })

    this.#unsubscribeBalanceEvents = this.#balances.on('balance:updated', () => {
      void this.#applyCachedBalance()
    })

    /*
      A sent-transaction status change redraws history and re-fetches
      the balance.

      Balance because a confirmed transfer changes it, and the cache
      does not know: it updates on a timer, and until the next poll
      the user would see the old amount next to an already-confirmed
      operation.
    */
    this.#unsubscribeTransactionEvents = this.#transactionService.on(
      'transaction:statusChanged',
      () => {
        void this.#onTransactionStatusChanged()
      },
    )

    /* Tracking starts right after the services are built: a tx sent
       in the previous session may have confirmed while the wallet
       was closed. */
    this.#transactionService.startTracking()
  }

  /** Re-read history and balance after a transaction status change. */
  async #onTransactionStatusChanged(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null) {
      return
    }

    this.#balances?.invalidate(account.address, network.chainId)

    await this.#loadHistory(account, network)
    await this.#loadBalance(account, network)
  }

  /**
   * Username for the first account's label.
   *
   * Also reads the older email key: wallets created before the
   * rename store the label there, and without the fallback their
   * owners would see a faceless "Account 1" instead of what they
   * typed. Lives in secure storage, so only an open session can
   * read it. `null` means the wallet was created without an
   * address — a normal state, not an error.
   */
  async #readUserName(): Promise<string | null> {
    const username = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UserName,
    )

    if (username !== null) {
      return username
    }

    return await this.#secureStorage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UserEmail)
  }

  /**
   * Read stored consent to a price source.
   *
   * A missing record means "never asked" and equals a refusal:
   * a default must not permit what reveals the portfolio to a
   * third party.
   */
  async #readPricesConsent(): Promise<boolean> {
    return (
      (await this.#storage.get<boolean>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.PricesEnabled)) ===
      true
    )
  }

  async #readSimulationConsent(): Promise<boolean> {
    return (
      (await this.#storage.get<boolean>(
        STORAGE_NAMESPACE.Settings,
        SETTINGS_KEY.SimulationSourceEnabled,
      )) === true
    )
  }

  /**
   * Read Tenderly credentials.
   *
   * Two sources, and settings beat build variables. `.env` values
   * land in the program text and are available to anyone who opened
   * the wallet — fine for a local check, not for a shipped build.
   * Owner-entered values live in encrypted storage and belong to
   * them alone, so they override the build ones.
   *
   * `null` means neither source has data.
   */
  async #readTenderlyCredentials(): Promise<ITenderlyCredentials | null> {
    const stored = await Promise.all([
      this.#storage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyAccount),
      this.#storage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyProject),
      this.#storage.get<string>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.TenderlyAccessKey),
    ])

    const account = nonEmpty(stored[0])
    const project = nonEmpty(stored[1])
    const accessKey = nonEmpty(stored[2])

    /* All three or nothing: two of three is not "half configured"
       but a broken trio better called "not set" than sent as a
       request that will fail. */
    if (account !== null && project !== null && accessKey !== null) {
      return { account, project, accessKey }
    }

    return this.#buildCredentials
  }

  /**
   * Build the simulation service.
   *
   * A third-party source is added only when both are true:
   * credentials entered AND consent given. The check lives here,
   * not in the UI: a path to simulation will appear from confirm,
   * a dapp request, call decode — and a rule that depends on every
   * caller breaks at the first extra call site.
   */
  async #buildSimulation(): Promise<void> {
    const credentials = await this.#readTenderlyCredentials()
    const isEnabled = await this.#readSimulationConsent()

    const sources =
      credentials === null || !isEnabled
        ? []
        : [new TenderlySimulationProvider({ credentials, logger: this.#logger })]

    this.#simulation = new SimulationService({ logger: this.#logger, sources })
  }

  /** Rebuild the service and tell the screen the new source state. */
  async #refreshSimulation(): Promise<void> {
    await this.#buildSimulation()

    this.#publish({
      ...this.#snapshot,
      isTenderlyConfigured: (await this.#readTenderlyCredentials()) !== null,
      isSimulationSourceEnabled: await this.#readSimulationConsent(),
      simulationSourceName: this.#simulation?.activeSourceName() ?? null,
    })
  }

  /**
   * Derive the HD wallet from the stored mnemonic.
   *
   * Protection boundary. The phrase comes back from storage as a
   * string: `SecureStorage` serializes via JSON, where `Uint8Array`
   * silently corrupts. A JavaScript string cannot be wiped — it
   * stays on the heap until GC. All that is reachable here is not
   * holding a reference longer than needed and wiping derived
   * buffers explicitly.
   */
  async #deriveHdWallet(): Promise<HDWalletService> {
    const { HDWalletService } = await import('@/core/hdwallet')

    const phrase = await this.#secureStorage.get<string>(
      STORAGE_NAMESPACE.Vault,
      VAULT_KEY.Mnemonic,
    )

    if (phrase === null) {
      throw new WalletNotInitializedError()
    }

    const mnemonic = this.#mnemonicService.fromPhrase(phrase)

    try {
      const seed = await this.#mnemonicService.toSeed(mnemonic)

      try {
        return HDWalletService.fromSeed(seed)
      } finally {
        seed.wipe()
      }
    } finally {
      mnemonic.wipe()
    }
  }

  /** Reload data that depends on the active account and network. */
  async #reloadAccountScopedData(): Promise<void> {
    const accounts = this.#requireAccounts()
    const networks = this.#requireNetworks()
    const activeAccount = accounts.getActive()
    const activeNetwork = networks.getActive()

    this.#publish({
      ...this.#snapshot,
      state: SESSION_STATE.Open,
      error: null,
      accounts: accounts.listVisible(),
      activeAccount,
      networks: networks.list(),
      activeNetwork,
      transfers: [],
      historyLimits: null,
      historyCursor: null,
      isHistoryLoading: activeAccount !== null,
      isHistoryLoadingMore: false,
      tokenBalances: [],
      isTokensLoading: activeAccount !== null,
      /* NFTs reset with the network and account: showing one
         address's collection under another is showing someone
         else's property as yours. A new search starts when the
         owner opens the section. */
      nfts: null,
      nftLimits: null,
      isNftLoading: false,
      /* Approvals are issued in an address's name and live in
         that network's contracts: showing one address's list
         under another would reassure the owner with someone
         else's data. */
      approvals: null,
      approvalLimits: null,
      isApprovalsLoading: false,
      /* Names reset with the network: an Ethereum-valid name
         next to a Polygon balance would claim more than is
         known. */
      ensNames: EMPTY_ENS_NAMES,
      isEnsSupported:
        activeNetwork !== null && this.#ens?.isSupported(activeNetwork.chainId) === true,
      /* The estimate resets with balances: the previous network's
         portfolio next to the new one is someone else's sum
         under someone else's name. */
      portfolio: null,
      priceError: null,
      rpcEndpoints:
        activeNetwork === null ? [] : this.#requireProviders().listEndpoints(activeNetwork),
      activeRpcEndpoint: null,
      isBalanceLoading: activeAccount !== null,
      balanceError: null,
    })

    this.#resubscribeBalance(activeAccount, activeNetwork)

    await this.#loadBalance(activeAccount, activeNetwork)
    await this.#publishActiveEndpoint(activeNetwork)
    await this.#loadTokens(activeAccount, activeNetwork)

    /* The estimate is computed after balances: without them
       there is nothing to value. */
    await this.#loadPortfolio()

    /* History loads last and is not waited on for the rest of
       the screen: it needs a log walk or an indexer and takes
       seconds. Leaving the whole screen empty — including an
       already-fetched balance — for that is unnecessary. */
    await this.#loadHistory(activeAccount, activeNetwork)

    await this.#loadEnsNames()
  }

  /**
   * Resolve ENS names for the wallet's own accounts.
   *
   * Only own addresses are queried. Reverse-resolving every
   * address seen — for example every counterparty in history —
   * would mean two node calls per list row and a detailed
   * report to the node operator about whom the user deals with.
   *
   * A node refusal hides the name and is not an error: a label
   * under the address is decoration, and the screen must not
   * fall because of it.
   */
  async #loadEnsNames(): Promise<void> {
    const ens = this.#ens
    const network = this.#snapshot.activeNetwork

    if (ens === null || network === null || !ens.isSupported(network.chainId)) {
      return
    }

    const found = new Map<string, string>()

    for (const account of this.#snapshot.accounts) {
      try {
        const resolution = await ens.lookupAddress(account.address)

        if (resolution !== null) {
          /* Store the display form, not the canonical one:
             canonical exists for node uniqueness, and emoji
             in it render black-and-white. */
          found.set(account.address.toLowerCase(), resolution.displayName)
        }
      } catch (error) {
        this.#logger.warn('The ENS name could not be fetched', {
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (found.size === 0) {
      return
    }

    this.#publish({ ...this.#snapshot, ensNames: found })
  }

  /**
   * Write the connected node address into the snapshot.
   *
   * Runs after the balance request, not before: until the first
   * call there is no connection, and showing a presumed address
   * instead of the live one would mislead — failover may have
   * moved to another node.
   */
  async #publishActiveEndpoint(network: INetworkConfig | null): Promise<void> {
    if (network === null || this.#providers === null) {
      return
    }

    try {
      const provider = await this.#providers.get(network)

      this.#publish({
        ...this.#snapshot,
        activeRpcEndpoint: provider instanceof FailoverProvider ? provider.activeEndpoint : null,
      })
    } catch {
      /* Network unavailability is already in `balanceError`. A
         second message about the same event adds nothing. */
    }
  }

  /**
   * Load the token list with balances.
   *
   * Balances are read one at a time: public nodes rate-limit,
   * and a dozen concurrent calls get a refusal instead of a
   * reply. Failure for one token does not cancel the rest —
   * the row is shown without an amount, not dropped.
   */
  async #loadTokens(account: IAccount | null, network: INetworkConfig | null): Promise<void> {
    if (account === null || network === null || this.#tokens === null) {
      this.#publish({ ...this.#snapshot, isTokensLoading: false })

      return
    }

    const service = this.#tokens
    const balances: ITokenBalance[] = []

    for (const token of service.list(network.chainId)) {
      if (token.address === null) {
        /* Native currency was already fetched in a separate
           request: repeating it for list uniformity would
           double the calls. */
        balances.push({ token, balance: this.#snapshot.balance?.raw ?? null })
        continue
      }

      try {
        balances.push({ token, balance: await service.getBalance(token, account.address) })
      } catch (error) {
        this.#logger.warn('Token balance is unavailable', {
          reason: error instanceof Error ? error.message : String(error),
        })
        balances.push({ token, balance: null })
      }
    }

    this.#publish({ ...this.#snapshot, tokenBalances: balances, isTokensLoading: false })
  }

  /**
   * Compute the portfolio estimate.
   *
   * Rates are not requested without consent. The check lives
   * here, not in the UI: a path to the estimate will appear
   * from other places, and a rule that depends on every caller
   * breaks at the first extra call site.
   *
   * A source failure does not zero the portfolio. `PriceService`
   * returns what it could get, and the failure reason goes into
   * the snapshot as a separate field: the screen must say
   * "could not get the value", not show zero.
   */
  async #loadPortfolio(): Promise<void> {
    if (!this.#snapshot.arePricesEnabled || this.#prices === null) {
      return
    }

    const amounts = this.#snapshot.tokenBalances

    if (amounts.length === 0) {
      this.#publish({ ...this.#snapshot, portfolio: null, isPortfolioLoading: false })

      return
    }

    this.#publish({ ...this.#snapshot, isPortfolioLoading: true })

    const service = this.#prices
    const quotes = await service.getPrices(
      amounts.map(({ token }) => ({ chainId: token.chainId, address: token.address })),
    )

    this.#publish({
      ...this.#snapshot,
      portfolio: buildPortfolio(amounts, quotes),
      priceError: service.lastError,
      isPortfolioLoading: false,
    })
  }

  #requireTokens(): TokenService {
    if (this.#tokens === null) {
      throw new Error('The wallet session is closed.')
    }

    return this.#tokens
  }

  /**
   * Load transfer history.
   *
   * A source failure does not leave the screen empty:
   * `HistoryService` at least returns local sends. An exception
   * reaches here only when the network is down; then history
   * stays empty and the loading flag is cleared — otherwise
   * the screen would spin forever.
   */
  async #loadHistory(account: IAccount | null, network: INetworkConfig | null): Promise<void> {
    if (account === null || network === null || this.#history === null) {
      this.#publish({ ...this.#snapshot, isHistoryLoading: false, historyCursor: null })

      return
    }

    try {
      const page = await this.#history.getHistory(account.address, network.chainId)

      this.#publish({
        ...this.#snapshot,
        transfers: this.#withKnownAssets(page.transfers, network.chainId),
        historyLimits: page.limits,
        /* The cursor is replaced, not appended: this is a
           read from the start, and paging must continue from
           it, not from the previous stretch. */
        historyCursor: page.cursor,
        isHistoryLoading: false,
        isHistoryLoadingMore: false,
      })
    } catch (error) {
      this.#logger.warn('The transfer history is unavailable', {
        reason: error instanceof Error ? error.message : String(error),
      })

      this.#publish({ ...this.#snapshot, isHistoryLoading: false, historyCursor: null })
    }
  }

  /**
   * Fill in the symbol and decimals of known tokens.
   *
   * Why. History sources return a contract address, not its
   * metadata: log parsing does not read them, and the history
   * core describes own sends from signed data, which also
   * lacks them. Without this fill-in, ten USDC just sent look
   * like "10000000 units of a contract".
   *
   * Only tracked tokens are filled. The user added them or
   * they came from the built-in list; their decimals were
   * read from the contract. For an unknown address the fields
   * stay empty and the record is honestly marked as raw units
   * — inventing the usual eighteen decimals is forbidden,
   * that would distort the amount by orders of magnitude.
   *
   * The symbol stays untrusted: the contract author set it.
   * Here it is only copied from the token list, where a
   * hand-added token is already distinguished from a built-in
   * one.
   */
  #withKnownAssets(
    transfers: readonly ITransferRecord[],
    chainId: ChainId,
  ): readonly ITransferRecord[] {
    const tokens = this.#tokens

    if (tokens === null) {
      return transfers
    }

    return transfers.map((record) => {
      const contract = record.asset.contract

      if (contract === null || record.asset.decimals !== null) {
        return record
      }

      const token = tokens.get({ chainId, address: contract })

      if (token === null) {
        return record
      }

      return {
        ...record,
        asset: { contract, symbol: token.symbol, decimals: token.decimals },
      }
    })
  }

  async #loadBalance(account: IAccount | null, network: INetworkConfig | null): Promise<void> {
    if (account === null || network === null || this.#balances === null) {
      this.#publish({ ...this.#snapshot, isBalanceLoading: false })

      return
    }

    try {
      const balance = await this.#balances.getNative(account.address, network.chainId)

      this.#publish({ ...this.#snapshot, balance, isBalanceLoading: false, balanceError: null })
    } catch (error) {
      this.#publishBalanceFailure(error)
    }
  }

  /** Put a background-poll update into the snapshot. */
  async #applyCachedBalance(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#balances === null) {
      return
    }

    try {
      const balance = await this.#balances.getNative(account.address, network.chainId)

      this.#publish({ ...this.#snapshot, balance, balanceError: null })
    } catch {
      /* A background-refresh failure must not erase the shown
         value: the previous balance marked stale is more useful
         than a blank. */
    }
  }

  #resubscribeBalance(account: IAccount | null, network: INetworkConfig | null): void {
    this.#unsubscribeBalance?.()
    this.#unsubscribeBalance = null

    if (
      account === null ||
      network === null ||
      this.#balances === null ||
      !this.#isBackgroundRefreshEnabled
    ) {
      return
    }

    this.#unsubscribeBalance = this.#balances.subscribe(account.address, network.chainId)
  }

  #publishBalanceFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)

    this.#logger.warn('The balance is unavailable', { reason: message })

    /* The previous value is kept: a node failure does not mean
       there are no funds. Replacing the balance with zero when
       the network is down is outright misinformation. */
    this.#publish({
      ...this.#snapshot,
      isBalanceLoading: false,
      balanceError: message,
    })
  }

  #requireAccounts(): AccountManager {
    if (this.#accounts === null) {
      throw new Error('The wallet session is closed.')
    }

    return this.#accounts
  }

  #requireNetworks(): NetworkService {
    if (this.#networks === null) {
      throw new Error('The wallet session is closed.')
    }

    return this.#networks
  }

  #requireProviders(): RpcManager {
    if (this.#providers === null) {
      throw new Error('The wallet session is closed.')
    }

    return this.#providers
  }

  #requireActiveNetwork(): INetworkConfig {
    const network = this.#snapshot.activeNetwork

    if (network === null) {
      throw new Error('No active network is selected.')
    }

    return network
  }

  /**
   * Finish a prepared transaction into what a person sees.
   *
   * One path for every sign flow. Transfer, token, NFT, revoke,
   * speed-up and cancel all arrive here the same way: otherwise
   * a check added to one path would skip the rest.
   *
   * A preflight failure does not abort prepare. An unreachable
   * node means "could not check", and that state is shown
   * separately from "checked and fine".
   */
  async #describePrepared(transaction: ISignableTransaction): Promise<IPreparedTransfer> {
    const transactions = this.#requireTransactions()

    return {
      transaction,
      fees: await transactions.estimateFees(transaction),
      preflight: await this.#preflight(transaction),
      /* Await, do not start together with preflight: the library
         batches concurrent calls into one JSON-RPC pack, and
         public nodes refuse the pack for rate limits. Seen on
         history logs — the same error cost the whole history. */
      simulation: await this.#simulate(transaction),
    }
  }

  /**
   * Add a hardware-wallet account.
   *
   * There is no secret here: address and path are stored, the
   * key stays on the device.
   */
  async addHardwareAccount(params: IAddHardwareAccountParams): Promise<IAccount> {
    const accounts = this.#requireAccounts()
    const account = await accounts.addHardwareAccount(params)

    this.#publish({ ...this.#snapshot, accounts: accounts.listVisible() })

    return account
  }

  /**
   * Run a dapp call on the node before showing confirmation.
   *
   * This is where the check matters most. An own send was
   * composed by the owner and is clear to them; a dapp call is
   * a byte string of which only the app name is known, and
   * that name is unproven.
   *
   * Only send requests are checked: signing a message or
   * typed data does nothing on-chain, so there is nothing to
   * run.
   */
  async checkDappRequest(request: IDappRequest): Promise<IPreflightResult> {
    const payload = request.payload

    if (
      payload.kind === DAPP_REQUEST_KIND.SignMessage ||
      payload.kind === DAPP_REQUEST_KIND.SignTypedData
    ) {
      return UNCHECKED_PREFLIGHT
    }

    const transaction = payload.transaction

    return await this.#preflightCall({
      from: transaction.from,
      to: transaction.to,
      data: transaction.data ?? ('0x' as HexString),
      value: toWei(transaction.value),
    })
  }

  /**
   * Run the transaction on the node before signing.
   *
   * A preflight failure is not thrown outward: it says nothing
   * about the transaction and must not block signing. "Could
   * not check" is more honest than failing prepare.
   */
  async #preflight(transaction: ISignableTransaction): Promise<IPreflightResult> {
    return await this.#preflightCall({
      from: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    })
  }

  /**
   * Show the transaction's effects before signing.
   *
   * Failure does not abort prepare. A node that does not know
   * the method is common; prepare must not fail because of
   * that, and the "unchecked" state reaches the screen as a
   * separate outcome.
   */
  async #simulate(transaction: ISignableTransaction): Promise<ISimulationResult> {
    const network = this.#snapshot.activeNetwork

    if (network === null || this.#providers === null) {
      return UNCHECKED_SIMULATION
    }

    try {
      const request = {
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      }
      const provider = await this.#providers.get(network)

      /* The service can be missing only on a closed session; for
         that case a direct path to the node remains, not a
         refusal to check. */
      return this.#simulation === null
        ? await simulateTransaction(provider, request)
        : await this.#simulation.simulate(provider, request, network.chainId)
    } catch (error) {
      this.#logger.warn('The transaction could not be simulated before signing', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return UNCHECKED_SIMULATION
    }
  }

  /** Shared preflight: network and node come from the current session. */
  async #preflightCall(request: IPreflightRequest): Promise<IPreflightResult> {
    const network = this.#snapshot.activeNetwork

    if (network === null || this.#providers === null) {
      return UNCHECKED_PREFLIGHT
    }

    try {
      return await preflightCall(await this.#providers.get(network), request)
    } catch (error) {
      this.#logger.warn('The call could not be checked before signing', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return UNCHECKED_PREFLIGHT
    }
  }

  #publish(snapshot: IWalletSnapshot): void {
    this.#snapshot = snapshot

    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}

/**
 * Append an earlier history stretch to what is shown.
 *
 * Duplicates are dropped by record id, not by hash: one
 * transaction yields dozens of transfers that share a hash.
 * Overlaps are legitimate — source windows meet at the
 * boundary — and a silently doubled transfer reads as two
 * sends instead of one.
 *
 * Order is kept: what is shown stays put, new rows follow.
 * Re-sorting would move rows under the finger of whoever is
 * reading the list.
 */
function appendTransfers(
  shown: readonly ITransferRecord[],
  earlier: readonly ITransferRecord[],
): readonly ITransferRecord[] {
  const seen = new Set<string>(shown.map((record) => record.id))

  return [...shown, ...earlier.filter((record) => !seen.has(record.id))]
}

/**
 * A string without edge whitespace, or `null`.
 *
 * Empty and missing are the same: both mean "not set".
 * Whitespace is trimmed because an access key usually arrives
 * pasted from the clipboard with a trailing newline.
 */
function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
