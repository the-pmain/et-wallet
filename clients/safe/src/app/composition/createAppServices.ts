import {
  AlchemyHistoryProvider,
  AlchemyProvider,
  CatalogPriceProvider,
  CoinGeckoMarketClient,
  type ITenderlyCredentials,
  ConsoleLogger,
  LogScanHistoryProvider,
  CustomRpcProvider,
  EncryptionService,
  IndexedDbStorageService,
  LedgerDevice,
  PublicRpcProvider,
  SecureStorage,
  SystemClock,
  appMarketCatalog,
  fetchCoinbaseEthUsd,
  type IClock,
  type IHardwareDevice,
  type IStorageService,
} from '@/core'
import { DappSessionService, SecureSessionStorage, WalletConnectTransport } from '@/features/dapp'
import {
  OnboardingService,
  RemoteUserDirectory,
  WalletBroadcast,
  type IOnboardingService,
} from '@/features/onboarding'
import { SecuritySettingsRepository } from '@/features/security'
import { WalletSession, type IWalletSession } from '@/features/wallet'
import { APP_CONFIG } from '@/shared/config'

import { syncCreatedWalletsToDirectory } from './sync-wallets'

/** Services that live for the whole app lifetime. */
export interface IAppServices {
  readonly onboarding: IOnboardingService
  readonly session: IWalletSession

  /**
   * Cross-tab notification channel.
   *
   * Built here, not inside the provider: the service sends messages,
   * the provider receives them, and they must share one channel.
   */
  readonly broadcast: WalletBroadcast

  /**
   * Time source.
   *
   * Exposed for auto-lock: it counts idle time, and a test must be
   * able to inject controllable clocks instead of the system clock.
   */
  readonly clock: IClock

  readonly securitySettings: SecuritySettingsRepository

  /** Dapp connections. Transport starts on demand. */
  readonly dappSessions: DappSessionService

  /**
   * App storage.
   *
   * Exposed for one question: will the data survive a tab close, and
   * may the browser evict it. The answer decides whether the owner
   * sees a warning about losing the wallet.
   */
  readonly storage: IStorageService
}

/**
 * App composition root.
 *
 * HERE AND ONLY HERE are concrete implementations chosen. No service
 * creates its own dependencies: swapping storage for IndexedDB or for
 * `chrome.storage` in the extension touches this file and no other.
 *
 * ONE SECURE STORE FOR THE WHOLE APP. `SecureStorage` owns the session
 * encryption key derived from the password. A second instance over the
 * same store would have its own key and could not read what the first
 * wrote — hence one instance for onboarding and for the wallet session.
 *
 * STORAGE IS PERSISTENT. Data lives in IndexedDB and survives a tab
 * reload. In-memory storage remains in the project for tests and for
 * a possible "leave no trace on this device" mode.
 *
 * THE BROWSER MAY EVICT SITE DATA when space is short, and for a
 * wallet that is loss of the encrypted seed phrase. Storage requests
 * persistent storage on open; whether it was granted is visible
 * through `IndexedDbStorageService.isPersistent`.
 */
export function createAppServices(): IAppServices {
  const storage = new IndexedDbStorageService()
  const encryption = new EncryptionService()
  const secureStorage = new SecureStorage(storage, encryption)
  const clock = new SystemClock()
  const logger = new ConsoleLogger()

  const session = new WalletSession({
    secureStorage,
    storage,
    clock,
    logger,
    rpcProviders: createRpcProviders(secureStorage),
    historyProviders: createHistoryProviders(),
    priceProvider: createPriceProvider(),
    tenderlyCredentials: readTenderlyCredentials(),
    connectHardware: connectLedger,
  })

  const broadcast = new WalletBroadcast()
  const dappSessions = createDappSessions(session, secureStorage, logger)
  const userDirectory = createUserDirectory(logger)

  notifyDappsOnWalletChange(session, dappSessions)

  if (userDirectory !== undefined) {
    syncCreatedWalletsToDirectory(session, userDirectory)
  }

  return {
    onboarding: new OnboardingService({
      secureStorage,
      broadcast,
      ...(userDirectory === undefined ? {} : { userDirectory }),
    }),
    session,
    broadcast,
    clock,
    securitySettings: new SecuritySettingsRepository(storage),
    dappSessions,
    storage,
  }
}

/**
 * Notifies connected apps when the network or account changes.
 *
 * SUBSCRIBE TO THE SNAPSHOT, NOT A SEPARATE EVENT. The wallet session
 * publishes the snapshot as a whole; this remembers the previous
 * "network — address" pair and notifies only when it changed. Without
 * the comparison, apps would get an event on every balance refresh.
 *
 * THE LINK LIVES AS LONG AS THE SERVICES. Both are created for the
 * app lifetime and disappear with it, so there is nothing to
 * unsubscribe from: there would be no moment to do it.
 */
export function notifyDappsOnWalletChange(
  session: Pick<IWalletSession, 'subscribe' | 'getSnapshot'>,
  dappSessions: Pick<DappSessionService, 'notifyWalletState'>,
): void {
  let previous = ''

  session.subscribe(() => {
    const snapshot = session.getSnapshot()
    const current = `${snapshot.activeNetwork?.chainId ?? ''}:${snapshot.activeAccount?.address ?? ''}`

    if (current === previous) {
      return
    }

    previous = current
    void dappSessions.notifyWalletState()
  })
}

/**
 * Dapp connections.
 *
 * THE SERVICE IS ALWAYS BUILT; TRANSPORT STARTS ON DEMAND.
 * The WalletConnect library is about three megabytes and is loaded
 * dynamically when the connections screen is opened; without a project
 * key the section opens and says it is not configured.
 *
 * ADDRESSES AND NETWORKS ARE READ FROM THE SESSION BY FUNCTIONS, NOT
 * COPIED. The user changes account and network on the fly; a snapshot
 * taken at construction would give the app stale values.
 */
function createDappSessions(
  session: IWalletSession,
  secureStorage: SecureStorage,
  logger: ConsoleLogger,
): DappSessionService {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''

  return new DappSessionService({
    transport: new WalletConnectTransport({
      projectId,
      metadata: {
        name: APP_CONFIG.name,
        description: `${APP_CONFIG.name} — non-custodial crypto wallet`,
        url: globalThis.location.origin,
        icons: [`${globalThis.location.origin}/icons/icon-128.png`],
      },
      logger,
      /* Connection state holds exchange encryption keys with apps,
         so it is stored encrypted and disappears with the wallet. */
      storage: new SecureSessionStorage(secureStorage, logger),
    }),
    logger,
    getAddresses: () => session.getSnapshot().accounts.map((account) => account.address),
    getActiveChainId: () => session.getSnapshot().activeNetwork?.chainId ?? null,
    getAvailableChainIds: () => session.getSnapshot().networks.map((network) => network.chainId),
    execute: (request) => session.executeDappRequest(request),
    preflight: (request) => session.checkDappRequest(request),
  })
}

/**
 * User directory on Fastify.
 *
 * Not wired in tests: otherwise `importWallet` would hit a live server.
 * An empty base URL posts `POST /v1/users` to the same origin — Vite
 * proxies to 8080.
 */
function createUserDirectory(logger: ConsoleLogger) {
  if (import.meta.env.MODE === 'test') {
    return undefined
  }

  const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? ''

  return new RemoteUserDirectory({ baseUrl: configured, logger })
}

/**
 * Tenderly credentials from the build environment.
 *
 * READ HERE, NOT IN CORE. `import.meta.env` is a bundler peculiarity;
 * core must compile where it does not exist — in tests and in the
 * extension service worker.
 *
 * THIS PATH IS FOR CHECKS ON YOUR OWN MACHINE. A value from `.env`
 * lands in the shipped program text and belongs to anyone who opened
 * it; the access key can spend the project quota. Owner-entered data
 * from encrypted storage therefore overrides these, not the reverse.
 *
 * `null` is a working state: the node computes transaction effects.
 */
function readTenderlyCredentials(): ITenderlyCredentials | null {
  const account = import.meta.env.VITE_TENDERLY_ACCOUNT ?? ''
  const project = import.meta.env.VITE_TENDERLY_PROJECT ?? ''
  const accessKey = import.meta.env.VITE_TENDERLY_ACCESS_KEY ?? ''

  /* All three or none: two of three is enough for a request that
     is guaranteed to be rejected. */
  if (account === '' || project === '' || accessKey === '') {
    return null
  }

  return { account, project, accessKey }
}

/**
 * Price source.
 *
 * THE PUBLIC MARKET IS FETCHED ONCE ON OPEN. `/coins/markets` does
 * not name the owner's addresses — it is the same catalog as the
 * table on the home screen. Portfolio valuation and the showcase
 * read this snapshot and do not call CoinGecko again.
 */
function createPriceProvider(): CatalogPriceProvider {
  const apiKey = import.meta.env.VITE_COINGECKO_API_KEY ?? null
  const hasKey = apiKey !== null && apiKey !== ''

  appMarketCatalog.configure({
    loadMarkets: (signal) =>
      new CoinGeckoMarketClient({
        ...(hasKey ? { apiKey } : {}),
      }).getMarkets(signal),
    loadEthUsd: fetchCoinbaseEthUsd,
  })

  return new CatalogPriceProvider(appMarketCatalog)
}

/**
 * Transfer-history sources in preference order.
 *
 * THE INDEXER IS WIRED ONLY WHEN A KEY IS PRESENT, and that is a
 * deliberate policy, not a technical side effect.
 *
 * The indexer is the only way to see native-currency transfers: they
 * emit no events and are physically absent from node logs. In return
 * it receives the user's address and returns their entire financial
 * history at once — portfolio size, counterparties, time of every
 * operation. A regular RPC node sees only the requests sent to it.
 *
 * So without an explicit key the wallet works from log scanning:
 * history is incomplete, but no third-party service learns whose
 * address it is or what happened on it. The incompleteness is shown
 * to the user, not hidden.
 */
function createHistoryProviders() {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? null
  const useIndexer = apiKey !== null && apiKey !== ''

  return useIndexer
    ? [new AlchemyHistoryProvider(), new LogScanHistoryProvider()]
    : [new LogScanHistoryProvider()]
}

/**
 * RPC address sources in preference order.
 *
 * ORDER IS POLICY, AND IT IS SET HERE, not inside the failover
 * machinery:
 *
 * 1. The user's own node. Chosen deliberately and the only one that
 *    does not disclose addresses to a third-party operator.
 * 2. Alchemy — the default when the user specified nothing.
 * 3. Public nodes from the network config — work without a key.
 *
 * THE ALCHEMY KEY COMES FROM THE ENVIRONMENT AND IS PUBLIC. Vite
 * substitutes `VITE_*` values into the bundle: anyone who opens the
 * page source will see the key. Domain restriction in the Alchemy
 * dashboard is required — see `.env.example`.
 *
 * WITHOUT A KEY ALCHEMY YIELDS NO ADDRESSES, and the wallet works
 * on public nodes. That is a working state, not a failure.
 */
function createRpcProviders(secureStorage: SecureStorage) {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? null

  return [
    new CustomRpcProvider(secureStorage),
    new AlchemyProvider({ apiKey }),
    new PublicRpcProvider(),
  ]
}

/**
 * Hardware-wallet connection.
 *
 * THE CONNECTION OPENS PER OPERATION AND IS NOT CACHED. The device
 * can be unplugged at any time, and the browser permission applies
 * to the chosen device, not forever: keeping the connection open
 * would promise access that may already be gone, and we would learn
 * that in the middle of a signature.
 *
 * The connection library is loaded as a separate module: few people
 * need it, and it is heavy enough not to ship to everyone.
 */
async function connectLedger(): Promise<IHardwareDevice> {
  const { WebHidTransport } = await import('@/features/hardware')

  return new LedgerDevice(await WebHidTransport.connect())
}
