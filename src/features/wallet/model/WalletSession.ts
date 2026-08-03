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
  PREFLIGHT_OUTCOME,
  preflightCall,
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
 * Пустой набор имён ENS.
 *
 * Один экземпляр на всё приложение: `useSyncExternalStore` сравнивает
 * снимок по ссылке, и новая пустая карта на каждую публикацию давала бы
 * перерисовку без изменения данных.
 */
const EMPTY_ENS_NAMES: ReadonlyMap<string, string> = new Map()

/** Итог непроведённого прогона. Отдельная константа ради стабильности ссылки. */
const UNCHECKED_PREFLIGHT: IPreflightResult = {
  outcome: PREFLIGHT_OUTCOME.Unavailable,
  reason: null,
  revertData: null,
}

/** Снимок закрытой сессии. Один экземпляр: пересоздание вызывало бы перерисовку. */
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
  ensNames: EMPTY_ENS_NAMES,
  isEnsSupported: false,
  rpcEndpoints: [],
  activeRpcEndpoint: null,
}

/** Зависимости сессии. */
export interface IWalletSessionDependencies {
  /** Та же сессия дешифрования, что у онбординга. */
  readonly secureStorage: ISecureStorage

  /** Незашифрованное хранилище — для конфигураций сетей. */
  readonly storage: IStorageService

  readonly clock: IClock
  readonly logger: ILogger

  /**
   * Фабрика соединений с узлами.
   *
   * Точка подмены для тестов. Без неё проверка сессии обращалась бы
   * к настоящим публичным RPC: тест становится медленным, зависящим
   * от сети и от чужой доступности.
   */
  readonly providerFactory?: IProviderFactory

  /**
   * Источники RPC endpointов в порядке предпочтения.
   *
   * Задаются снаружи: набор источников и их приоритет — политика
   * приложения, а не свойство сессии. Источник пользовательских адресов
   * добавляется сюда автоматически, если его нет в списке, — без него
   * не работали бы добавление и удаление собственного узла.
   *
   * По умолчанию используется публичный источник. Alchemy сюда не входит:
   * он требует ключа, а ключ читается из окружения слоем приложения
   * и в ядро не передаётся.
   */
  readonly rpcProviders?: readonly IRpcProvider[]

  /**
   * Источники истории переводов в порядке предпочтения.
   *
   * По умолчанию — только разбор журналов узла: он работает везде,
   * не требует ключа и, главное, не передаёт адрес пользователя
   * стороннему сервису. Индексатор добавляется слоем приложения,
   * потому что решение «полнота в обмен на приватность» принимает
   * владелец кошелька, а не ядро.
   */
  readonly historyProviders?: readonly IHistoryProvider[]

  /** Подключение аппаратного кошелька по требованию. */
  readonly connectHardware?: () => Promise<IHardwareDevice>

  /**
   * Источник курсов.
   *
   * По умолчанию — источник, который курсов не знает. Это не заглушка:
   * пока пользователь не согласился на обращение к стороннему сервису,
   * кошелёк курсов не запрашивает. Боевой источник подставляет слой
   * приложения, потому что решение «оценка портфеля в обмен
   * на раскрытие его состава» принимает владелец средств, а не ядро.
   */
  readonly priceProvider?: IPriceProvider
}

/**
 * Набор сервисов разблокированного кошелька.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ОБЪЕКТ, А НЕ СБОРКА В КОМПОНЕНТЕ. Сервисы связаны общим
 * временем жизни: `HDWalletService` держит корневой ключ, `RpcManager` —
 * открытые соединения, `BalanceService` — таймеры опроса. Разложенные по
 * компонентам React, они пережили бы блокировку кошелька: размонтирование
 * дерева не гарантировано, а `useEffect` с очисткой выполняется не всегда
 * в том порядке, в каком нужно затирать ключи.
 *
 * ПОРЯДОК ЗАКРЫТИЯ ЗНАЧИМ. Сначала останавливается опрос, затем рвутся
 * соединения, и только потом затирается корневой ключ. Обратный порядок
 * оставил бы запущенный таймер, обращающийся к уничтоженным сервисам.
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
   * Соединение с аппаратным кошельком.
   *
   * Внедряется снаружи: WebHID существует только в браузере, и сессия
   * о нём знать не обязана. Отсутствие означает сборку без поддержки
   * устройств.
   */
  readonly #connectHardware: (() => Promise<IHardwareDevice>) | null
  readonly #priceProvider: IPriceProvider
  readonly #listeners = new Set<() => void>()

  /* Один экземпляр на сессию: сервис не хранит состояния, а создание
     его заново в каждом методе, которому он нужен, — размножение
     одинаковых объектов без причины. */
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

  /* Фоновый опрос включён, пока вкладка на виду. Управляет им слой
     интерфейса: `document.visibilityState` — часть DOM, а сессия
     обязана работать и в service worker расширения, где документа нет. */
  #isBackgroundRefreshEnabled = true

  /* Защита от повторного входа: экран может вызвать open() дважды —
     например, при быстрой смене состояния разблокировки. */
  #opening: Promise<void> | null = null

  constructor(dependencies: IWalletSessionDependencies) {
    this.#secureStorage = dependencies.secureStorage
    this.#storage = dependencies.storage
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SESSION_NAME)
    this.#providerFactory =
      dependencies.providerFactory ?? new LazyRpcClientFactory({ logger: dependencies.logger })

    /* Набор по умолчанию содержит публичный источник. Без него сессия,
       собранная без явного списка, не получила бы ни одного адреса
       и не подключилась бы никуда: Alchemy требует ключа, а ключ живёт
       в слое приложения и в ядро не попадает. */
    const configured = dependencies.rpcProviders ?? [new PublicRpcProvider()]
    const existingCustom = configured.find(
      (provider): provider is CustomRpcProvider => provider instanceof CustomRpcProvider,
    )

    this.#customRpc = existingCustom ?? new CustomRpcProvider(dependencies.secureStorage)

    /* Собственный узел пользователя идёт первым: он выбран сознательно,
       и подставлять вместо него значение по умолчанию значило бы отменять
       решение владельца средств. */
    this.#rpcProviders =
      existingCustom === undefined ? [this.#customRpc, ...configured] : configured

    this.#historyProviders = dependencies.historyProviders ?? [new LogScanHistoryProvider()]
    this.#connectHardware = dependencies.connectHardware ?? null
    this.#priceProvider = dependencies.priceProvider ?? new NullPriceProvider()
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

    /* Слежение останавливается вместе с сессией: таймер, переживший
       блокировку, продолжал бы опрашивать узел и раскрывать
       оператору, что кошелёк с этими адресами существует. */
    this.#transactionService?.stopTracking()

    this.#balances?.stop()
    await this.#providers?.destroy()

    /* Кэши очищаются ДО обнуления ссылок: после него звать их не у кого.
       Названия коллекций и метаданные токенов не секрет, но связь
       «этот кошелёк интересовался этими контрактами» переживать
       блокировку не должна — по тем же причинам, что и кэш имён. */
    this.#nfts?.clear()
    this.#approvals?.clear()

    /* Затирание корневого ключа — последнее действие и единственное,
       ради которого существует весь этот порядок. */
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

    /* Кэш имён сбрасывается вместе с сессией: он связывает адреса
       кошелька с именами, и переживать блокировку эта связь не должна. */
    this.#ens?.clearCache()
    this.#ens = null

    this.#publish(CLOSED_SNAPSHOT)
  }

  /**
   * Возвращает менеджер резервного копирования.
   *
   * ПОЧЕМУ ПОДСЕРВИС, А НЕ ПЯТЬ МЕТОДОВ-ОБЁРТОК. Сессия и без того велика,
   * а пять делегирующих методов не добавили бы ни одной проверки — только
   * пять мест, где сигнатуры могут разойтись с оригиналом. Экспорт секретов
   * при этом остаётся связанным с временем жизни сессии: заблокированный
   * кошелёк менеджера не отдаёт вовсе.
   *
   * @throws NotInitializedError при закрытой сессии.
   */
  getBackup(): IBackupManager {
    if (this.#backup === null) {
      throw new NotInitializedError(SESSION_NAME)
    }

    return this.#backup
  }

  /**
   * Включает и выключает фоновый опрос баланса.
   *
   * ЗАЧЕМ ВЫКЛЮЧАТЬ. Опрос на скрытой вкладке тратит лимиты узла
   * и — что важнее — продолжает сообщать его оператору, что кошелёк
   * с этим адресом открыт, пока пользователь занимается чем-то другим.
   * Обновлять невидимый экран незачем.
   *
   * ВОЗВРАТ НА ВКЛАДКУ ОБНОВЛЯЕТ ЗНАЧЕНИЕ СРАЗУ, а не через период
   * опроса: показанный баланс к этому моменту заведомо устарел.
   *
   * Вызывается слоем интерфейса: `document.visibilityState` — часть DOM,
   * а ядро и сессия обязаны работать там, где документа нет.
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

    /* Кэш балансов привязан к паре «адрес + сеть», но показанное значение
       относится к прежней сети. Оставить его на экране означало бы показать
       баланс одной сети под именем другой. */
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

    /* Список сетей публикуется сразу, без перезагрузки данных аккаунта:
       добавление сети не делает её активной, и трогать баланс с историей
       незачем. */
    this.#publish({ ...this.#snapshot, networks: this.#requireNetworks().list() })
  }

  async removeNetwork(chainId: ChainId): Promise<void> {
    const networks = this.#requireNetworks()
    const wasActive = this.#snapshot.activeNetwork?.chainId === chainId

    await networks.remove(chainId)

    /* Соединение с удалённой сетью закрывается: оставленное открытым,
       оно продолжало бы опрашивать узел, которого в списке уже нет. */
    await this.#requireProviders().release(chainId)

    this.#publish({
      ...this.#snapshot,
      networks: networks.list(),
      activeNetwork: networks.getActive(),
    })

    /* Удаление активной сети переводит кошелёк на сеть по умолчанию,
       и все привязанные к сети данные — баланс, история, список узлов —
       обязаны быть перечитаны. */
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
   * Дозагружает более ранний участок истории.
   *
   * ЗАПРОС ИДЁТ РОВНО ОДИН. Второе нажатие при незавершённом первом
   * ушло бы с той же меткой и вернуло бы тот же участок; записи
   * отсеялись бы по ключу, но узел был бы опрошен дважды, а оператор
   * увидел бы адрес лишний раз.
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

      /* Активный аккаунт либо сеть могли смениться, пока узел отвечал.
         Дописать полученное к чужой истории значило бы показать
         операции другого адреса как свои. */
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

      /* Метка сохраняется: отказ узла — не конец истории, и повторная
         попытка обязана начинаться с того же места. */
      this.#publish({ ...this.#snapshot, isHistoryLoadingMore: false })
    }
  }

  async previewToken(address: Address): Promise<ITokenMetadata> {
    const network = this.#requireActiveNetwork()

    return await this.#requireTokens().fetchMetadata(network.chainId, address)
  }

  async addToken(address: Address, symbolOverride?: string): Promise<void> {
    const network = this.#requireActiveNetwork()

    await this.#requireTokens().add({
      chainId: network.chainId,
      address,
      ...(symbolOverride === undefined ? {} : { symbol: symbolOverride }),
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
   * Разбирает введённого получателя.
   *
   * ПОРЯДОК ПРОВЕРОК ОТ ДЕШЁВЫХ К ДОРОГИМ: пустое, адрес, непохожее
   * на имя — всё это решается без обращения к сети. Узел спрашивается
   * только там, где иначе нельзя.
   *
   * ИСКЛЮЧЕНИЙ НЕ БРОСАЕТ. Разбор идёт по мере ввода, и отказ узла
   * обязан стать состоянием на экране: «проверить не удалось» —
   * это то, что пользователь должен прочитать, а не то, что должно
   * попасть в консоль.
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
   * Обратное разрешение адреса, не мешающее вводу.
   *
   * Отказ узла оставляет подпись пустой: адрес уже известен и годен
   * к отправке, а имя — только украшение.
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

    /* Кэш очищается вместе с отзывом согласия: оставить в памяти курсы,
       полученные по прежнему разрешению, значило бы продолжать
       показывать оценку после отказа от неё. */
    this.#prices?.invalidate()

    this.#publish({
      ...this.#snapshot,
      arePricesEnabled: false,
      portfolio: null,
      priceError: null,
      isPortfolioLoading: false,
    })
  }

  async refreshPrices(): Promise<void> {
    this.#prices?.invalidate()

    await this.#loadPortfolio()
  }

  /**
   * Готовит перевод к подписи.
   *
   * ЗАМЕЧАНИЯ К ПОЛУЧАТЕЛЮ ЗДЕСЬ НЕ СЧИТАЮТСЯ. Часть из них — прежде
   * всего отсутствие контрольной суммы — видна только по тому, как
   * пользователь ввёл адрес, а `prepare` работает с нормализованным
   * значением. Считать их по нормализованному значит не находить
   * их никогда, поэтому проверка выполняется там, где есть исходный
   * ввод, — на экране отправки.
   */
  async prepareTransfer(request: ITransactionRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepare(request))
  }

  /**
   * Подписывает и публикует перевод.
   *
   * ПОДПИСЫВАЕТСЯ ИМЕННО ПЕРЕДАННЫЙ ОБЪЕКТ. Пересчёт полей между показом
   * пользователю и подписью создал бы расхождение между тем, что человек
   * подтвердил, и тем, что ушло в сеть.
   *
   * АККАУНТ ОПРЕДЕЛЯЕТСЯ ПО ПОЛЮ `from`, а не берётся активным: между
   * подготовкой и подтверждением пользователь мог переключить аккаунт,
   * и подпись чужим ключом отправила бы средства не с того адреса.
   * `SigningService` эту подмену тоже отвергнет, но полагаться
   * на последний рубеж вместо явного выбора неправильно.
   */
  async sendTransfer(transaction: ISignableTransaction): Promise<TxHash> {
    const accounts = this.#requireAccounts()
    const sender = accounts.getByAddress(transaction.from)

    if (sender === null) {
      throw new Error('The sender does not belong to this wallet.')
    }

    const signed = await accounts.signTransaction(sender.id, transaction)
    const hash = await this.#requireTransactions().send(signed)

    /* История и баланс перечитываются: отправленная транзакция обязана
       появиться в списке сразу, иначе пользователь решит, что отправка
       не состоялась. */
    this.#balances?.invalidate()
    await this.#reloadAccountScopedData()

    return hash
  }

  /**
   * Ищет адреса, которыми уже пользовались, и добавляет недостающие.
   *
   * ЗАПУСКАЕТСЯ ВЛАДЕЛЬЦЕМ. Поиск сообщает оператору узла два десятка
   * адресов разом и связывает их между собой; делать это без спроса
   * при каждом запуске значило бы раскрывать больше, чем нужно.
   * Исключение — первое открытие восстановленного кошелька: там цена
   * молчания выше, и поиск выполняется сам, один раз.
   *
   * @returns Сколько аккаунтов добавлено.
   */
  async discoverAccounts(): Promise<IAccountDiscoverySummary> {
    const accounts = this.#requireAccounts()
    const hdWallet = this.#hdWallet

    /* Сеть берётся у сервиса, а не из снимка: при первом открытии
       поиск выполняется раньше, чем снимок заполнен, и по снимку
       он молча не находил бы ничего. */
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

    /* УПЁРЛИСЬ В ПРЕДЕЛ — ЗНАЧИТ, УЗЕЛ ОТВЕЧАЕТ НЕДОСТОВЕРНО.
       Занятыми оказались все проверенные адреса подряд, чего у живого
       кошелька не бывает: так выглядит либо узел-обманка, либо
       неисправность. Создать по такому ответу две сотни аккаунтов
       значило бы засорить кошелёк мусором, который нельзя удалить —
       HD-аккаунты только скрываются. */
    if (result.stoppedByLimit) {
      this.#logger.warn(
        'Account discovery stopped at the limit: the node answers for every address',
      )

      return { added: 0, scanned: result.scanned, stoppedByLimit: true }
    }

    /* Уже существующие адреса пропускаются: поиск повторяем,
       а создание аккаунта — нет. */
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
   * Выполняет поиск один раз за жизнь кошелька.
   *
   * Отказ не мешает открытию сессии: кошелёк с одним аккаунтом
   * работоспособен, а поиск повторяется по кнопке в настройках.
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
   * Ищет разрешения, выданные активным аккаунтом.
   *
   * ЗАПРОС ИДЁТ ТОЛЬКО ПО ТРЕБОВАНИЮ — как и поиск предметов: это
   * выборка журналов и обращение к каждому найденному контракту.
   */
  async loadApprovals(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#approvals === null) {
      return
    }

    this.#publish({ ...this.#snapshot, isApprovalsLoading: true })

    const page = await this.#approvals.list(account.address, network.chainId)

    /* Ответ применяется, только если аккаунт и сеть не сменились:
       чужой список разрешений под новым адресом успокоил бы владельца
       без оснований. */
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

  /** Готовит отзыв выданного разрешения. */
  async prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareRevokeApproval(request),
    )
  }

  /**
   * Ищет коллекционные предметы активного аккаунта.
   *
   * ЗАПРОС ИДЁТ ТОЛЬКО ПО ТРЕБОВАНИЮ. Поиск — это выборка журналов
   * и обращение к каждому найденному контракту: десятки запросов
   * и подробный след у оператора узла. Делать это при каждом входе
   * в кошелёк значило бы платить за то, чего владелец не просил.
   */
  async loadNfts(): Promise<void> {
    const account = this.#snapshot.activeAccount
    const network = this.#snapshot.activeNetwork

    if (account === null || network === null || this.#nfts === null) {
      return
    }

    this.#publish({ ...this.#snapshot, isNftLoading: true })

    const page = await this.#nfts.list(account.address, network.chainId)

    /* Ответ применяется, только если аккаунт и сеть не сменились, пока
       шёл поиск: чужой список под новым адресом читается как чужое
       имущество. */
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
   * Готовит перевод токена ERC-20 к подписи.
   *
   * ОТДЕЛЬНЫЙ МЕТОД, А НЕ ПРИЗНАК В `prepareTransfer`. У перевода токена
   * поле `to` подписываемой транзакции указывает на контракт, а получатель
   * и сумма лежат в данных вызова. Общая форма для двух разных операций
   * рано или поздно приводит к тому, что адрес контракта принимают
   * за адрес человека.
   */
  async prepareTokenTransfer(request: ITokenTransferRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareTokenTransfer(request),
    )
  }

  /**
   * Готовит передачу коллекционного предмета к подписи.
   *
   * Как и у токена, транзакция адресована контракту, а получатель
   * лежит в данных вызова. Экран подтверждения показывает оба адреса.
   */
  async prepareNftTransfer(request: INftTransferRequest): Promise<IPreparedTransfer> {
    return await this.#describePrepared(
      await this.#requireTransactions().prepareNftTransfer(request),
    )
  }

  /**
   * Готовит ускорение зависшей транзакции.
   *
   * ОТПРАВЛЯЕТСЯ ОБЫЧНЫМ `sendTransfer`. Замена — такая же транзакция
   * с подписью и комиссией; отдельный путь отправки означал бы второе
   * место, где решается, что подписывать, и подтверждение пользователя
   * можно было бы обойти.
   */
  async prepareSpeedUp(hash: TxHash): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepareSpeedUp(hash))
  }

  /** Готовит отмену зависшей транзакции. */
  async prepareCancel(hash: TxHash): Promise<IPreparedTransfer> {
    return await this.#describePrepared(await this.#requireTransactions().prepareCancel(hash))
  }

  /**
   * Определяет, является ли адрес контрактом.
   *
   * ЗАПРОС ВЫПОЛНЯЕТСЯ ОДИН РАЗ, НА ШАГЕ ПОДТВЕРЖДЕНИЯ, а не при вводе
   * адреса: проверка на каждое нажатие клавиши означала бы запрос
   * к узлу на каждый набранный символ.
   */
  async isContractRecipient(address: Address): Promise<boolean | null> {
    const network = this.#snapshot.activeNetwork

    if (network === null || this.#providers === null) {
      return null
    }

    try {
      return await isContractAddress(address, await this.#providers.get(network))
    } catch {
      /* Недоступность узла — это «проверить не удалось», а не «адрес
         обычный». Второе успокаивало бы без оснований. */
      return null
    }
  }

  /**
   * Выполняет запрос, одобренный пользователем.
   *
   * ВЫЗЫВАЕТСЯ ТОЛЬКО ПОСЛЕ ПОДТВЕРЖДЕНИЯ. Метод не показывает экранов
   * и не оценивает риски: это сделано выше, и повторять здесь значило бы
   * иметь два места, где решается, что считать согласием.
   *
   * ОТПРАВИТЕЛЬ СВЕРЯЕТСЯ ЗАНОВО. Проверка была при приёме запроса,
   * но между приёмом и подтверждением пользователь мог сменить аккаунт;
   * подписать чужим адресом нечем, и узнать об этом надо до подписи.
   *
   * @returns Подпись либо хэш транзакции — то, что ожидает приложение.
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

    /* Транзакция проходит через ту же подготовку, что и отправка
       из кошелька: оценка газа, проверка средств, выбор типа. Второй
       путь к подписи означал бы вторую точку, где эти проверки можно
       забыть. */
    const prepared = await this.#requireTransactions().prepare({
      chainId: request.chainId,
      from: payload.transaction.from,
      /* ПОЛУЧАТЕЛЬ ПЕРЕДАЁТСЯ КАК ПРИСЛАН, ВКЛЮЧАЯ ЕГО ОТСУТСТВИЕ.
         Пустое поле означает развёртывание контракта, и экран
         подтверждения говорит об этом прямо. Прежде сюда подставлялся
         адрес отправителя: пользователь одобрял создание контракта,
         а подписывал перевод самому себе с байт-кодом в данных вызова —
         газ списывался, одобренная операция не выполнялась. */
      to: payload.transaction.to,
      value: toWei(payload.transaction.value),
      ...(payload.transaction.data === null ? {} : { data: payload.transaction.data }),
    })

    const signed = await accounts.signTransaction(sender.id, prepared)

    if (payload.kind === DAPP_REQUEST_KIND.SignTransaction) {
      /* Приложение просило подписать, но не отправлять: публикация
         здесь была бы действием, о котором пользователя не спрашивали. */
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

      /* Согласие читается до загрузки данных: иначе первая загрузка
         прошла бы без курсов, и оценка появилась бы только со второй. */
      this.#publish({
        ...this.#snapshot,
        arePricesEnabled: await this.#readPricesConsent(),
        priceSourceName: this.#priceProvider.name,
      })

      await this.#reloadAccountScopedData()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      this.#logger.error('The wallet session could not be opened', { reason: message })

      /* Частично построенные сервисы обязаны быть разобраны: иначе
         в памяти остался бы выведенный корневой ключ при неоткрытой сессии. */
      await this.close()
      this.#publish({ ...CLOSED_SNAPSHOT, state: SESSION_STATE.Failed, error: message })
    }
  }

  /** Выводит ключи и поднимает сервисы. */
  async #buildServices(): Promise<void> {
    /* Модули подписи и HD-дерева подгружаются здесь, а не статически.
       Они тянут за собой ethers — самую тяжёлую зависимость приложения,
       которой нет дела до экранов приветствия, создания кошелька
       и разблокировки. Момент загрузки совпадает с моментом, когда
       сервисы действительно нужны: сессия открывается после ввода
       пароля. Порядок сборки и время жизни ключей не меняются. */
    const { AccountManager } = await import('@/core/account')

    this.#hdWallet = await this.#deriveHdWallet()

    this.#providers = new RpcManager({
      providers: this.#rpcProviders,
      factory: this.#providerFactory,
      clock: this.#clock,
      logger: this.#logger,
    })

    this.#networks = new NetworkService({
      /* Сети хранятся зашифрованными: у пользовательской сети
         в `rpcUrls` лежит адрес её узла, обычно с ключом учётной записи
         в строке. Открытое хранилище передаётся вторым: из него
         переносятся записи, сделанные прежними версиями. */
      repository: new NetworkRepository(this.#secureStorage, this.#storage),
      providerFactory: this.#providerFactory,
      logger: this.#logger,
      builtInNetworks: BUILT_IN_NETWORKS,
      defaultChainId: DEFAULT_CHAIN_ID,
    })

    await this.#networks.init()

    /* Пользовательские адреса читаются после списка сетей: они хранятся
       по chainId, и перечень сетей нужен, чтобы знать, что читать. */
    await this.#customRpc.init(this.#networks.list())

    this.#accounts = AccountManager.create({
      hdWallet: this.#hdWallet,
      secureStorage: this.#secureStorage,
      clock: this.#clock,
      logger: this.#logger,
      ...(this.#connectHardware === null ? {} : { connectHardware: this.#connectHardware }),
    })

    await this.#accounts.init()

    /* Кошелёк, только что созданный из seed-фразы, аккаунтов не содержит:
       онбординг сохраняет фразу, но не выводит из неё адреса. Без первого
       аккаунта экран показал бы пустой список и никакого способа его
       заполнить. */
    if (this.#accounts.list().length === 0) {
      /* Первый аккаунт получает имя из адреса электронной почты, если
         владелец его указал: подпись «Аккаунт 1» ничего не говорит
         человеку, у которого кошельков несколько. Последующие аккаунты
         нумеруются как раньше — они принадлежат тому же владельцу
         и одинаковой подписью не различались бы. */
      const username = await this.#readUserName()

      await this.#accounts.create(username === null ? {} : { name: username })
    }

    /* ВОССТАНОВЛЕННЫЙ КОШЕЛЁК ОБЯЗАН НАЙТИ СВОИ АККАУНТЫ. Адреса
       выводятся из фразы, но кошелёк о них не знает, пока не выведет:
       у человека, у которого их было пять, четыре просто не появятся,
       и он увидит вместо своих средств пустой кошелёк.

       ПОИСК НЕ ЗАДЕРЖИВАЕТ ОТКРЫТИЕ. Это два десятка пар запросов
       к узлу; ожидание их в критическом пути означало бы, что кошелёк
       открывается минуту на медленной сети. Найденное добавляется
       к списку по мере готовности. */
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

    /* Список токенов читается после инициализации сетей: он хранится
       по chainId, и перечень сетей нужен, чтобы знать, что читать. */
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

    /* Журнал экспортов лежит в зашифрованном хранилище. Секретов он
       не содержит, но сообщает наблюдателю с доступом к диску, что
       владелец выгружал seed-фразу и когда. */
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
      Смена состояния отправленной транзакции перерисовывает историю
      и перезапрашивает баланс.

      Баланс — потому что подтверждение перевода меняет его, а кэш
      об этом не знает: он обновляется по времени, и до следующего
      опроса пользователь видел бы прежнюю сумму рядом с уже
      подтверждённой операцией.
    */
    this.#unsubscribeTransactionEvents = this.#transactionService.on(
      'transaction:statusChanged',
      () => {
        void this.#onTransactionStatusChanged()
      },
    )

    /* Слежение начинается сразу после сборки сервисов: транзакция,
       отправленная в прошлой сессии, могла подтвердиться, пока
       кошелёк был закрыт. */
    this.#transactionService.startTracking()
  }

  /** Перечитывает историю и баланс после смены состояния транзакции. */
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
   * Читает сохранённое согласие на обращение к источнику курсов.
   *
   * Отсутствие записи означает «не спрашивали» и равносильно отказу:
   * умолчание не вправе разрешать то, что раскрывает состав портфеля
   * стороннему сервису.
   */
  /**
   * Читает адрес электронной почты владельца.
   *
   * Лежит в защищённом хранилище, поэтому доступен только открытой
   * сессии. `null` означает, что кошелёк создан без адреса, — обычное
   * состояние, а не ошибка.
   */
  /**
   * Имя пользователя для подписи первого аккаунта.
   *
   * Читается и прежний ключ с почтой: кошельки, созданные до замены,
   * хранят подпись там, и без запаса их владельцы увидели бы безликое
   * «Аккаунт 1» вместо того, что вводили сами.
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

  async #readPricesConsent(): Promise<boolean> {
    return (
      (await this.#storage.get<boolean>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.PricesEnabled)) ===
      true
    )
  }

  /**
   * Выводит HD-кошелёк из сохранённой мнемонической фразы.
   *
   * ГРАНИЦА ЗАЩИТЫ. Фраза возвращается из хранилища строкой: `SecureStorage`
   * сериализует значения через JSON, где `Uint8Array` молча портится.
   * Строку в JavaScript затереть невозможно — она остаётся в куче до сборки
   * мусора. Всё, что здесь достижимо, — не удерживать на неё ссылку дольше
   * необходимого и затереть производные буферы явно.
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

  /** Перечитывает данные, зависящие от активного аккаунта и сети. */
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
      /* Предметы сбрасываются вместе с сетью и аккаунтом: показать
         коллекцию одного адреса под другим — то же, что показать чужое
         имущество как своё. Новый поиск начнётся, когда владелец
         откроет раздел. */
      nfts: null,
      nftLimits: null,
      isNftLoading: false,
      /* Разрешения выдаются от имени адреса и живут в контрактах
         конкретной сети: показать список одного адреса под другим
         значило бы успокоить владельца чужими данными. */
      approvals: null,
      approvalLimits: null,
      isApprovalsLoading: false,
      /* Имена сбрасываются вместе с сетью: имя, действительное
         в Ethereum, показанное рядом с балансом Polygon, утверждало бы
         больше, чем известно. */
      ensNames: EMPTY_ENS_NAMES,
      isEnsSupported:
        activeNetwork !== null && this.#ens?.isSupported(activeNetwork.chainId) === true,
      /* Оценка сбрасывается вместе с балансами: портфель прошлой сети,
         показанный рядом с новой, — это чужая сумма под чужим именем. */
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

    /* Оценка считается после балансов: без них считать нечего. */
    await this.#loadPortfolio()

    /* История загружается последней и без ожидания: она требует обхода
       журналов либо обращения к индексатору и занимает секунды. Держать
       из-за неё пустым весь экран, включая уже полученный баланс,
       незачем. */
    await this.#loadHistory(activeAccount, activeNetwork)

    await this.#loadEnsNames()
  }

  /**
   * Находит имена ENS аккаунтов кошелька.
   *
   * ЗАПРАШИВАЮТСЯ ТОЛЬКО СВОИ АДРЕСА. Обратное разрешение каждого
   * встреченного адреса — например, всех контрагентов в истории —
   * означало бы по два обращения к узлу на строку списка и подробный
   * рассказ оператору узла о том, с кем пользователь имеет дело.
   *
   * Отказ узла имя не показывает и ошибкой не считается: подпись под
   * адресом — украшение, и ронять из-за неё экран нельзя.
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
          /* В карту кладётся форма для показа, а не каноническая:
             каноническая существует ради единственности узла и эмодзи
             в ней выглядят чёрно-белыми. */
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
   * Дописывает в снимок адрес узла, с которым установлено соединение.
   *
   * Выполняется после запроса баланса, а не до: до первого обращения
   * соединения не существует, и показывать предполагаемый адрес вместо
   * действующего значило бы вводить пользователя в заблуждение —
   * перебор мог увести на другой узел.
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
      /* Недоступность сети уже отражена в `balanceError`. Второе
         сообщение об одном и том же событии ничего не добавляет. */
    }
  }

  /**
   * Загружает список токенов с балансами.
   *
   * Балансы читаются по одному: публичные узлы ограничивают частоту
   * обращений, и десяток одновременных вызовов получает отказ вместо
   * ответа. Отказ по одному токену не отменяет остальных — строка
   * показывается без величины, а не исчезает.
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
        /* Нативная валюта уже получена отдельным запросом: повторять
           его ради единообразия списка значило бы удвоить обращения. */
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
   * Считает оценку портфеля.
   *
   * КУРСЫ НЕ ЗАПРАШИВАЮТСЯ БЕЗ СОГЛАСИЯ. Проверка стоит здесь, а не
   * в интерфейсе: путь к оценке появится и из других мест, и правило,
   * соблюдение которого зависит от каждого вызывающего, нарушается
   * при первом же добавлении такого места.
   *
   * ОТКАЗ ИСТОЧНИКА НЕ ОБНУЛЯЕТ ПОРТФЕЛЬ. `PriceService` возвращает
   * то, что смог получить, а причина отказа уходит в снимок отдельным
   * полем: экран обязан сказать «стоимость получить не удалось»,
   * а не показать ноль.
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
   * Загружает историю переводов.
   *
   * Отказ источника не оставляет экран без данных: `HistoryService`
   * возвращает хотя бы локальные отправки. Исключение сюда доходит
   * только при недоступной сети, и тогда история остаётся пустой,
   * а признак загрузки снимается — иначе экран крутил бы ожидание вечно.
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
        /* Метка заменяется, а не дополняется: это чтение с начала,
           и продолжать надо от него, а не от прежнего участка. */
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
   * Подставляет символ и число знаков известных токенов.
   *
   * ЗАЧЕМ. Источники истории возвращают адрес контракта, но не его
   * метаданные: разбор журналов их не читает, а собственные отправки
   * ядро истории описывает по подписанным данным, где их тоже нет.
   * Без подстановки только что отправленные десять USDC выглядят
   * в списке как «10000000 единиц контракта».
   *
   * ПОДСТАВЛЯЮТСЯ ТОЛЬКО ОТСЛЕЖИВАЕМЫЕ ТОКЕНЫ. Их пользователь добавил
   * сам либо они пришли из встроенного списка; число знаков для них
   * прочитано из контракта. Для незнакомого адреса значения остаются
   * пустыми, и запись честно помечается как показанная в необработанных
   * единицах — выдумывать привычные восемнадцать знаков нельзя,
   * это исказило бы сумму на порядки.
   *
   * СИМВОЛ ОСТАЁТСЯ НЕДОВЕРЕННЫМ: его задаёт автор контракта. Здесь он
   * лишь переносится из списка токенов, где отличие добавленного вручную
   * от встроенного уже отмечено.
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

  /** Кладёт в снимок значение, обновлённое фоновым опросом. */
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
      /* Отказ фонового обновления не должен стирать показанное значение:
         прежний баланс с пометкой устаревания полезнее пустого места. */
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

    /* Прежнее значение сохраняется: отказ узла не означает, что средств нет.
       Замена баланса нулём при недоступной сети — прямая дезинформация. */
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
   * Достраивает подготовленную транзакцию до того, что видит человек.
   *
   * ЕДИНАЯ ТОЧКА ДЛЯ ВСЕХ ПУТЕЙ ПОДПИСИ. Перевод, токен, предмет,
   * отзыв разрешения, ускорение и отмена приходят сюда одинаково:
   * иначе проверка, добавленная к одному пути, обошла бы остальные.
   *
   * ПРОГОН НЕ ПРЕРЫВАЕТ ПОДГОТОВКУ. Недоступный узел означает
   * «проверить не удалось», и это состояние показывается отдельно
   * от «проверено и всё хорошо».
   */
  async #describePrepared(transaction: ISignableTransaction): Promise<IPreparedTransfer> {
    const transactions = this.#requireTransactions()

    return {
      transaction,
      fees: await transactions.estimateFees(transaction),
      preflight: await this.#preflight(transaction),
    }
  }

  /**
   * Добавляет аккаунт аппаратного кошелька.
   *
   * Секрета здесь нет: сохраняются адрес и путь, ключ остаётся
   * в устройстве.
   */
  async addHardwareAccount(params: IAddHardwareAccountParams): Promise<IAccount> {
    const accounts = this.#requireAccounts()
    const account = await accounts.addHardwareAccount(params)

    this.#publish({ ...this.#snapshot, accounts: accounts.listVisible() })

    return account
  }

  /**
   * Прогоняет вызов приложения на узле до показа подтверждения.
   *
   * ЗДЕСЬ ПРОВЕРКА НУЖНЕЕ ВСЕГО. Собственная отправка составлена самим
   * владельцем и понятна ему; вызов приложения — набор байтов, о котором
   * известно только имя приложения, а имя это ничем не подтверждено.
   *
   * Проверяются только запросы на отправку: подпись сообщения и
   * структурированных данных ничего в цепи не выполняет, и прогонять
   * там нечего.
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
   * Прогоняет транзакцию на узле до подписи.
   *
   * Отказ самого прогона не выбрасывается наружу: он ничего не говорит
   * о транзакции и не должен мешать её подписать. Итог «проверить
   * не удалось» честнее отказа в подготовке.
   */
  async #preflight(transaction: ISignableTransaction): Promise<IPreflightResult> {
    return await this.#preflightCall({
      from: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    })
  }

  /** Общий прогон: сеть и узел берутся из текущего состояния сессии. */
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
 * Дописывает более ранний участок истории к показанному.
 *
 * ПОВТОРЫ ОТБРАСЫВАЮТСЯ ПО КЛЮЧУ, а не по хэшу: одна транзакция
 * порождает десятки переводов, и хэш у них общий. Повторы возникают
 * законно — окна источников перекрываются на границе, — и молча
 * удвоенный перевод читается как две отправки вместо одной.
 *
 * ПОРЯДОК СОХРАНЯЕТСЯ: показанное остаётся на месте, новое идёт следом.
 * Пересортировка сдвинула бы строки под пальцем у того, кто в этот
 * момент читает список.
 */
function appendTransfers(
  shown: readonly ITransferRecord[],
  earlier: readonly ITransferRecord[],
): readonly ITransferRecord[] {
  const seen = new Set<string>(shown.map((record) => record.id))

  return [...shown, ...earlier.filter((record) => !seen.has(record.id))]
}
