import type {
  AccountId,
  Address,
  ChainId,
  IAddNetworkParams,
  IAccount,
  IBackupManager,
  IBalance,
  IDappRequest,
  IHistoryCursor,
  IHistoryLimits,
  IPreflightResult,
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
  IToken,
  ITokenMetadata,
  ITokenTransferRequest,
  ITransactionRequest,
  ITransferRecord,
  TxHash,
} from '@/core'

/**
 * Токен вместе с его балансом.
 *
 * Баланс необязателен: контракт мог перестать отвечать, и потерять
 * из-за этого весь список хуже, чем показать строку без величины.
 * `null` означает «прочитать не удалось», а не ноль.
 */
export interface ITokenBalance {
  readonly token: IToken
  readonly balance: bigint | null
}

/**
 * Подготовленный перевод вместе с вариантами комиссии.
 *
 * `transaction` — ровно тот объект, который уйдёт в подпись. Экран
 * подтверждения показывает его поля, и он же передаётся в `sendTransfer`.
 */
export interface IPreparedTransfer {
  readonly transaction: ISignableTransaction
  readonly fees: readonly IFeeEstimate[]

  /**
   * Итог прогона вызова на узле до подписи.
   *
   * ПОКАЗЫВАЕТСЯ ВСЕГДА, включая случай «проверить не удалось».
   * Молчание кошелька о непроведённой проверке читается как её
   * успешное прохождение.
   */
  readonly preflight: IPreflightResult
}

/** Итог поиска занятых адресов. */
export interface IAccountDiscoverySummary {
  /** Сколько аккаунтов добавлено. */
  readonly added: number

  /** Сколько адресов проверено. Нужно, чтобы честно назвать глубину. */
  readonly scanned: number

  /**
   * Поиск прекращён пределом, а не промежутком пустых адресов.
   *
   * Значит, дальше могли остаться занятые, и говорить «это все ваши
   * аккаунты» нельзя.
   */
  readonly stoppedByLimit: boolean
}

/**
 * Итог разбора того, что введено в поле получателя.
 *
 * ПОЧЕМУ СОСТОЯНИЙ СТОЛЬКО. «Имени не существует», «имя написано
 * символами, которых мы не поддерживаем», «ENS не работает в этой сети»
 * и «узел не ответил» требуют от пользователя разных действий. Сведи их
 * к одному «неверный получатель» — и человек, у которого просто отвалился
 * узел, решит, что имени не существует, и отправит средства на адрес,
 * набранный по памяти.
 */
export const RECIPIENT_STATUS = {
  /** Поле пусто. */
  Empty: 'empty',
  /** Введён адрес. */
  Address: 'address',
  /** Имя разрешено в адрес. */
  NameResolved: 'name-resolved',
  /** Имя выглядит именем, но записи для него нет. */
  NameNotFound: 'name-not-found',
  /** Имя содержит символы вне поддерживаемого набора. */
  NameUnsupported: 'name-unsupported',
  /** Активна сеть, в которой реестра ENS не существует. */
  EnsUnavailable: 'ens-unavailable',
  /** Узел не ответил: проверить имя не удалось. */
  Failed: 'failed',
  /** Введённое не является ни адресом, ни именем. */
  Invalid: 'invalid',
} as const

export type RecipientStatus = (typeof RECIPIENT_STATUS)[keyof typeof RECIPIENT_STATUS]

/** Получатель, разобранный из строки ввода. */
export interface IRecipientResolution {
  readonly status: RecipientStatus

  /** Адрес получателя. `null`, пока его нет. */
  readonly address: Address | null

  /**
   * Имя, связанное с адресом, в виде для показа.
   *
   * Для введённого имени — то, из которого получен адрес. Для введённого
   * адреса — подтверждённая обратная запись, если она есть. `null`
   * в остальных случаях.
   */
  readonly name: string | null

  /**
   * Имя записано только символами ASCII.
   *
   * ENSIP-15 запрещает смешивать письменности внутри метки, но имя,
   * целиком записанное другой письменностью и похожее по начертанию
   * на латинское, остаётся законным и принадлежит другому человеку.
   * `true` при отсутствии имени: оговаривать нечего.
   */
  readonly isAscii: boolean
}

/** Состояние сессии кошелька. */
export const SESSION_STATE = {
  /** Кошелёк заблокирован либо ещё не создан: сервисов не существует. */
  Closed: 'closed',
  /** Идёт вывод ключей и чтение хранилища. */
  Opening: 'opening',
  /** Сессия готова, данные доступны. */
  Open: 'open',
  /** Открыть не удалось. Причина в снимке. */
  Failed: 'failed',
} as const

export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE]

/**
 * Неизменяемый снимок состояния кошелька для интерфейса.
 *
 * ПОЧЕМУ СНИМОК, А НЕ НАБОР ГЕТТЕРОВ. `useSyncExternalStore` сравнивает
 * результат `getSnapshot()` по ссылке и вызывает перерисовку при её смене.
 * Геттеры, собирающие объект заново при каждом вызове, дали бы новую ссылку
 * на каждом рендере и бесконечный цикл перерисовок.
 *
 * Поля с данными обновляются заменой всего снимка целиком.
 */
export interface IWalletSnapshot {
  readonly state: SessionState

  /** Причина отказа при `state === Failed`. */
  readonly error: string | null

  readonly accounts: readonly IAccount[]
  readonly activeAccount: IAccount | null

  readonly networks: readonly INetworkConfig[]
  readonly activeNetwork: INetworkConfig | null

  /** Баланс активного аккаунта в активной сети. `null`, пока не получен. */
  readonly balance: IBalance | null

  /** Причина последнего отказа запроса баланса. */
  readonly balanceError: string | null

  /** Идёт первичное получение баланса. */
  readonly isBalanceLoading: boolean

  /**
   * История переводов активного аккаунта в активной сети.
   *
   * Содержит переводы нативной валюты, токенов ERC-20 и коллекционных
   * токенов — в объёме, доступном подключённому источнику. Ограничения
   * описаны в `historyLimits` и обязаны быть показаны: неполная история,
   * выданная за полную, читается как пропавшие средства.
   */
  readonly transfers: readonly ITransferRecord[]

  /** Чем ограничена показанная история. `null`, пока она не загружена. */
  readonly historyLimits: IHistoryLimits | null

  /** Идёт загрузка истории. */
  readonly isHistoryLoading: boolean

  /**
   * Чем продолжить историю. `null` — продолжать нечем.
   *
   * ОТЛИЧАЕТ «ЭТО ВСЯ ИСТОРИЯ» ОТ «ЭТО ПЕРВЫЙ УЧАСТОК». Отбор
   * и поиск работают по загруженным записям, и пустой результат при
   * непустой метке означает лишь «среди загруженного не нашлось»,
   * а не «таких операций не было».
   */
  readonly historyCursor: IHistoryCursor | null

  /** Идёт дозагрузка более раннего участка. */
  readonly isHistoryLoadingMore: boolean

  /**
   * Отслеживаемые токены активной сети с балансами.
   *
   * Первым идёт нативная валюта: она есть в любой сети и не убирается.
   */
  readonly tokenBalances: readonly ITokenBalance[]

  /** Идёт загрузка балансов токенов. */
  readonly isTokensLoading: boolean

  /**
   * Коллекционные предметы активного аккаунта в активной сети.
   *
   * `null` означает «не запрашивали», пустой массив — «предметов
   * не найдено». Разница существенна: первое не утверждает ничего,
   * второе утверждает, что искали.
   *
   * СПИСОК НЕ ЗАГРУЖАЕТСЯ САМ. Поиск требует выборки журналов и запроса
   * к каждому найденному контракту — это десятки обращений к узлу
   * и подробный след активности у его оператора. Владелец запрашивает
   * их, открывая раздел.
   */
  readonly nfts: readonly INftItem[] | null

  /** Чем ограничен показанный список предметов. `null` до запроса. */
  readonly nftLimits: INftLimits | null

  /** Идёт поиск предметов. */
  readonly isNftLoading: boolean

  /**
   * Разрешения, выданные активным аккаунтом в активной сети.
   *
   * `null` означает «не запрашивали», пустой массив — «действующих
   * разрешений не найдено». Разница существенна: первое не утверждает
   * ничего, второе утверждает, что искали.
   *
   * СПИСОК НЕ ЗАГРУЖАЕТСЯ САМ — как и предметы: это выборка журналов
   * и обращение к каждому найденному контракту.
   */
  readonly approvals: readonly IApprovalRecord[] | null

  /** Чем ограничен показанный список разрешений. `null` до запроса. */
  readonly approvalLimits: IApprovalLimits | null

  /** Идёт поиск разрешений. */
  readonly isApprovalsLoading: boolean

  /**
   * Оценка портфеля активного аккаунта в активной сети.
   *
   * `null`, пока курсы не запрошены либо источник не подключён.
   * Пустая сводка и отсутствие сводки означают разное: первое —
   * «активов нет», второе — «стоимость неизвестна».
   */
  readonly portfolio: IPortfolioSummary | null

  /**
   * Пользователь разрешил обращаться к стороннему источнику курсов.
   *
   * Пока согласия нет, кошелёк курсов не запрашивает: запрос называет
   * сервису адрес контракта, то есть сообщает состав портфеля.
   */
  readonly arePricesEnabled: boolean

  /** Идёт загрузка курсов. */
  readonly isPortfolioLoading: boolean

  /** Причина последнего отказа источника курсов. */
  readonly priceError: string | null

  /** Имя подключённого источника курсов. Пользователь вправе его знать. */
  readonly priceSourceName: string

  /**
   * Подтверждённые имена ENS аккаунтов кошелька.
   *
   * Ключ — адрес в нижнем регистре. Присутствие ключа означает, что
   * обратная запись существует И подтверждена прямым разрешением:
   * непроверенных имён здесь не бывает.
   *
   * Пусто, когда активна сеть без ENS: имя, показанное вне сети,
   * где оно действительно, утверждало бы больше, чем известно.
   */
  readonly ensNames: ReadonlyMap<string, string>

  /** Работает ли ENS в активной сети. */
  readonly isEnsSupported: boolean

  /**
   * RPC-адреса активной сети в порядке предпочтения.
   *
   * Пользователь обязан видеть, к чьему узлу обращается кошелёк:
   * «работает» и «работает через стороннего оператора, видящего все
   * ваши адреса» — разные утверждения.
   */
  readonly rpcEndpoints: readonly IRpcEndpoint[]

  /** Адрес узла, с которым установлено соединение. `null` до подключения. */
  readonly activeRpcEndpoint: IRpcEndpoint | null
}

/**
 * Сессия разблокированного кошелька.
 *
 * ВРЕМЯ ЖИЗНИ ЖЁСТКО СВЯЗАНО С БЛОКИРОВКОЙ. Сессия владеет выведенным
 * из seed-фразы корневым ключом. `close()` обязан затереть его и разорвать
 * соединения с узлами: иначе заблокированный кошелёк продолжал бы держать
 * ключи в памяти и опрашивать RPC, раскрывая оператору активность
 * пользователя.
 */
export interface IWalletSession {
  getSnapshot(): IWalletSnapshot
  subscribe(listener: () => void): () => void

  /** Выводит ключи, поднимает сервисы и загружает данные. */
  open(): Promise<void>

  /** Затирает ключи, закрывает соединения, сбрасывает снимок. */
  close(): Promise<void>

  /**
   * Резервное копирование секретов: выдача seed-фразы и приватных ключей.
   *
   * Доступен только открытой сессии. Заблокированный кошелёк менеджера
   * не отдаёт: экран экспорта, оставшийся работоспособным после
   * автоблокировки, обесценил бы саму автоблокировку.
   *
   * @throws NotInitializedError при закрытой сессии.
   */
  getBackup(): IBackupManager

  /** Делает аккаунт активным. */
  selectAccount(id: AccountId): Promise<void>

  /** Создаёт следующий аккаунт HD-дерева. */
  createAccount(name?: string): Promise<void>

  /**
   * Ищет адреса, которыми уже пользовались, и добавляет недостающие.
   *
   * Нужен восстановленному кошельку: адреса выводятся из seed-фразы,
   * но кошелёк о них не знает, пока не выведет.
   */
  discoverAccounts(): Promise<IAccountDiscoverySummary>

  /** Переключает активную сеть. */
  switchNetwork(chainId: ChainId): Promise<void>

  /**
   * Добавляет пользовательскую сеть.
   *
   * Узел опрашивается до сохранения: сеть, чей узел обслуживает другую
   * цепь, в хранилище не попадёт.
   *
   * @throws NetworkImpersonationError если имя совпадает с именем
   *         встроенной сети при другом идентификаторе. Повторный вызов
   *         с `allowImpersonation: true` добавит её по согласию
   *         пользователя.
   * @throws NetworkAlreadyExistsError, InvalidRpcUrlError,
   *         InsecureRpcUrlError, ChainIdMismatchError,
   *         ProviderUnavailableError
   */
  addNetwork(params: IAddNetworkParams): Promise<void>

  /**
   * Удаляет пользовательскую сеть.
   *
   * Встроенные сети удалению не подлежат: их конфигурация — часть
   * защиты от подмены.
   *
   * @throws BuiltInNetworkImmutableError, NetworkNotFoundError
   */
  removeNetwork(chainId: ChainId): Promise<void>

  /** Перезапрашивает баланс, минуя кэш. */
  refreshBalance(): Promise<void>

  /**
   * Включает и выключает фоновый опрос баланса.
   *
   * Вызывается слоем интерфейса при уходе вкладки из виду и возврате
   * в неё. Опрос невидимого экрана тратит лимиты узла и продолжает
   * сообщать его оператору, что кошелёк открыт.
   */
  setBackgroundRefreshEnabled(enabled: boolean): void

  /**
   * Прогоняет вызов приложения на узле до показа подтверждения.
   *
   * Возвращает «проверить не удалось», а не выбрасывает исключение:
   * недоступность узла не должна мешать пользователю принять решение
   * самому.
   */
  checkDappRequest(request: IDappRequest): Promise<IPreflightResult>

  /** Перезапрашивает историю переводов активного аккаунта с начала. */
  refreshHistory(): Promise<void>

  /**
   * Дозапрашивает более ранний участок истории.
   *
   * Ничего не делает, когда продолжать нечем либо запрос уже идёт:
   * повторное нажатие не должно порождать вторую выборку с той же
   * меткой и удваивать записи.
   */
  loadMoreHistory(): Promise<void>

  /**
   * Читает метаданные контракта, не добавляя токен.
   *
   * Нужен форме добавления: пользователь обязан увидеть, что за токен
   * он добавляет, до подтверждения.
   *
   * @throws InvalidTokenContractError
   */
  previewToken(address: Address): Promise<ITokenMetadata>

  /**
   * Добавляет токен в активную сеть.
   *
   * Метаданные читаются из контракта; переданное число знаков сверяется
   * с ним и расхождение приводит к отказу.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  addToken(address: Address, symbolOverride?: string): Promise<void>

  /** Убирает токен из отслеживаемых. */
  removeToken(address: Address): Promise<void>

  /** Перезапрашивает балансы токенов активного аккаунта. */
  refreshTokens(): Promise<void>

  /**
   * Разбирает введённого получателя: адрес либо имя ENS.
   *
   * Исключений не бросает: форма вызывает разбор по мере ввода, и отказ
   * узла обязан стать состоянием на экране, а не ошибкой в консоли.
   */
  resolveRecipient(input: string): Promise<IRecipientResolution>

  /**
   * Разрешает обращаться к стороннему источнику курсов и загружает их.
   *
   * ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА СРЕДСТВ, А НЕ УМОЛЧАНИЕ. Запрос курса
   * называет источнику адрес контракта и сеть, то есть сообщает состав
   * портфеля. Адрес кошелька не передаётся: сервису неизвестно, чей
   * это портфель.
   */
  enablePrices(): Promise<void>

  /** Отзывает согласие. Курсы перестают запрашиваться, оценка исчезает. */
  disablePrices(): Promise<void>

  /** Перезапрашивает курсы, минуя кэш. */
  refreshPrices(): Promise<void>

  /**
   * Готовит перевод к подписи и считает варианты комиссии.
   *
   * Возвращённая транзакция — ровно то, что будет подписано. Экран
   * подтверждения обязан показывать её поля, а не пересчитывать
   * значения заново: расхождение показанного с подписанным — основной
   * класс атак на интерфейс кошелька.
   *
   * @throws GasEstimationFailedError если вызов завершится откатом,
   *         InsufficientFundsError если средств не хватает на перевод
   *         вместе с комиссией.
   */
  prepareTransfer(request: ITransactionRequest): Promise<IPreparedTransfer>

  /**
   * Подписывает и публикует подготовленную транзакцию.
   *
   * Принимает объект, полученный из `prepareTransfer` и показанный
   * пользователю, — без промежуточных пересчётов.
   *
   * @returns Хэш опубликованной транзакции.
   */
  sendTransfer(transaction: ISignableTransaction): Promise<TxHash>

  /**
   * Ищет разрешения, выданные активным аккаунтом.
   *
   * Вызывается разделом разрешений при открытии. Повторный вызов
   * перезапрашивает список.
   */
  loadApprovals(): Promise<void>

  /**
   * Готовит отзыв выданного разрешения.
   *
   * Отзыв — обычная транзакция: она стоит газа и требует подписи.
   * Отправляется тем же `sendTransfer`, что и перевод.
   */
  prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<IPreparedTransfer>

  /**
   * Ищет коллекционные предметы активного аккаунта.
   *
   * Вызывается разделом NFT при открытии. Повторный вызов перезапрашивает
   * список: он мог измениться с прошлого раза.
   */
  loadNfts(): Promise<void>

  /**
   * Готовит перевод токена ERC-20.
   *
   * Данные вызова собирает ядро: получатель и количество лежат в них,
   * а не в полях транзакции.
   *
   * @throws InsufficientTokenBalanceError если токенов меньше суммы.
   */
  prepareTokenTransfer(request: ITokenTransferRequest): Promise<IPreparedTransfer>

  /**
   * Готовит передачу коллекционного предмета.
   *
   * @throws NftNotOwnedError если предмет не принадлежит отправителю.
   */
  prepareNftTransfer(request: INftTransferRequest): Promise<IPreparedTransfer>

  /**
   * Готовит ускорение зависшей транзакции.
   *
   * Повторяет ТУ ЖЕ операцию с тем же номером и большей комиссией.
   * Результат отправляется обычным `sendTransfer`: замена — такая же
   * транзакция, и подтверждать её пользователь обязан так же.
   *
   * @throws TransactionNotReplaceableError если транзакция уже в блоке
   *         либо её параметры не сохранены.
   */
  prepareSpeedUp(hash: TxHash): Promise<IPreparedTransfer>

  /**
   * Готовит отмену зависшей транзакции.
   *
   * Cancel отправленное нельзя; можно занять его номер переводом
   * самому себе на нулевую сумму. Успех не гарантирован — исходная
   * транзакция может попасть в блок первой.
   *
   * @throws TransactionNotReplaceableError если транзакция уже в блоке.
   */
  prepareCancel(hash: TxHash): Promise<IPreparedTransfer>

  /**
   * Определяет, является ли адрес контрактом.
   *
   * Нужен предупреждению перед отправкой: нативная валюта, посланная
   * контракту, который её не принимает, теряется безвозвратно.
   *
   * @returns `null`, если узел не ответил. «Check не удалось»
   *          и «не контракт» — разные утверждения, и второе, показанное
   *          вместо первого, успокаивает без оснований.
   */
  isContractRecipient(address: Address): Promise<boolean | null>

  /**
   * Выполняет запрос приложения, одобренный пользователем.
   *
   * Экраны и оценка рисков остаются выше: этот метод только подписывает
   * и, если просили, отправляет. Второе место, где решается, что считать
   * согласием, было бы вторым местом, где это можно решить неверно.
   *
   * @returns Подпись либо хэш транзакции — то, что ожидает приложение.
   */
  executeDappRequest(request: IDappRequest): Promise<string>

  /**
   * Проверяет доступность всех RPC-адресов активной сети.
   *
   * Выполняет настоящие подключения и измеряет время ответа: оценить
   * пригодность узла, не обратившись к нему, невозможно.
   */
  checkRpcHealth(): Promise<readonly IRpcEndpointHealth[]>

  /**
   * Добавляет собственный RPC-адрес для активной сети.
   *
   * Узел проверяется до сохранения: адрес, обслуживающий другую сеть,
   * в хранилище не попадёт.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError, ChainIdMismatchError,
   *         ProviderUnavailableError
   */
  addRpcEndpoint(url: string): Promise<void>

  /** Удаляет собственный RPC-адрес активной сети. */
  removeRpcEndpoint(url: string): Promise<void>
}
