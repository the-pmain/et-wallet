import {
  ChainIdMismatchError,
  ENS_ADDR_SELECTOR,
  ENS_NAME_SELECTOR,
  ENS_REGISTRY_ADDRESS,
  ENS_RESOLVER_SELECTOR,
  EventBus,
  ProviderUnavailableError,
  areAddressesEqual,
  chainIdToHex,
  namehash,
  reverseNode,
  toAddress,
  type Address,
  type ChainId,
  type HexString,
  type ICallRequest,
  type IProvider,
  type IProviderFactory,
  type IFeeData,
  type ILogEntry,
  type ILogFilter,
  type INetworkConfig,
  type ProviderEventMap,
  type TxHash,
  type Wei,
} from '@/core'

/**
 * Провайдер-дублёр.
 *
 * Отвечает на `eth_chainId` заранее заданным значением. Именно это позволяет
 * проверить главную защиту сетевого модуля: отказ добавить сеть, если узел
 * обслуживает другую цепь.
 */
class FakeProvider implements IProvider {
  readonly chainId: ChainId
  readonly rpcUrl = 'https://fake.example.com'
  isActive = true

  readonly #reportedChainId: ChainId

  /* Баланс читается через функцию, а не копируется при создании.
     Соединения переиспользуются пулом, и тест, меняющий настройки
     после первого запроса, иначе не увидел бы нового значения. */
  readonly #readBalance: () => Wei | null
  readonly #readFeeData: () => IFeeData | null
  readonly #readSendError: () => string | null
  readonly #readLogs: () => readonly ILogEntry[]
  readonly #readLatestBlock: () => bigint
  readonly #readContracts: () => readonly string[]
  readonly #readEnsRecords: () => readonly IFakeEnsRecord[]
  readonly #events = new EventBus<ProviderEventMap>()

  constructor(
    chainId: ChainId,
    reportedChainId: ChainId,
    readBalance: () => Wei | null,
    readFeeData: () => IFeeData | null,
    readSendError: () => string | null,
    readLogs: () => readonly ILogEntry[],
    readLatestBlock: () => bigint,
    readContracts: () => readonly string[],
    readEnsRecords: () => readonly IFakeEnsRecord[],
  ) {
    this.chainId = chainId
    this.#reportedChainId = reportedChainId
    this.#readBalance = readBalance
    this.#readFeeData = readFeeData
    this.#readSendError = readSendError
    this.#readLogs = readLogs
    this.#readLatestBlock = readLatestBlock
    this.#readContracts = readContracts
    this.#readEnsRecords = readEnsRecords
  }

  request<TResult>(request: { readonly method: string }): Promise<TResult> {
    if (request.method === 'eth_chainId') {
      return Promise.resolve(chainIdToHex(this.#reportedChainId) as TResult)
    }

    return Promise.reject(new Error(`Метод "${request.method}" не поддержан дублёром.`))
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(this.#reportedChainId)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.#readLatestBlock())
  }

  getBalance(): Promise<Wei> {
    const balance = this.#readBalance()

    /* Отказ по умолчанию намеренный: тест, забывший задать баланс,
       обязан упасть, а не получить незаметный ноль. */
    return balance === null
      ? Promise.reject(new Error('Баланс не задан в настройках дублёра.'))
      : Promise.resolve(balance)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  /**
   * Вызов контракта.
   *
   * Поддержан только реестр ENS и его резолвер. Отказ по умолчанию
   * намеренный: тест, ожидающий ответа от контракта, о котором дублёр
   * не знает, обязан упасть, а не получить пустую строку.
   */
  call(request: ICallRequest): Promise<HexString> {
    const answer = answerEnsCall(request, this.#readEnsRecords())

    return answer === null
      ? Promise.reject(new Error('Не поддержано дублёром.'))
      : Promise.resolve(answer)
  }

  /**
   * Байт-код по адресу.
   *
   * По умолчанию адрес считается обычным. Тест, проверяющий
   * предупреждение о переводе на контракт, задаёт `contractAddresses`
   * явно: молчаливое «всё контракты» скрыло бы отсутствие проверки.
   */
  getCode(address: Address): Promise<HexString> {
    const contracts = this.#readContracts().map((item) => item.toLowerCase())

    return Promise.resolve(
      (contracts.includes(address.toLowerCase()) ? '0x60006000' : '0x') as HexString,
    )
  }

  estimateGas(): Promise<bigint> {
    return Promise.resolve(21000n)
  }

  /**
   * Данные о комиссии.
   *
   * Возвращаются значения работающей сети с поддержкой EIP-1559: отказ
   * здесь означал бы узел, у которого нельзя подготовить ни одну
   * транзакцию, а такой узел не годится даже как дублёр.
   */
  getFeeData(): Promise<IFeeData> {
    return Promise.resolve(
      this.#readFeeData() ?? {
        baseFeePerGas: 20_000_000_000n,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        gasPrice: 25_000_000_000n,
      },
    )
  }

  /**
   * Публикация подписанной транзакции.
   *
   * Возвращает постоянный хэш: тесты проверяют, что он доходит
   * до интерфейса, а не его конкретное значение.
   */
  sendRawTransaction(): Promise<TxHash> {
    const failure = this.#readSendError()

    return failure === null ? Promise.resolve(FAKE_TX_HASH) : Promise.reject(new Error(failure))
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  /**
   * Выборка журналов.
   *
   * Отбор выполняется по тем же правилам, что и на узле: диапазон блоков,
   * адрес контракта и позиционное совпадение тем, где `null` означает
   * «любое значение». Дублёр, отдающий все записи подряд, скрыл бы ошибку
   * в составлении запроса — а именно она приводит к пропаже операций
   * из истории.
   */
  getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    return Promise.resolve(this.#readLogs().filter((entry) => matchesFilter(entry, filter)))
  }

  destroy(): void {
    this.isActive = false
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

/** Настройки поведения фабрики в конкретном тесте. */
export interface IFakeProviderOptions {
  /**
   * Идентификатор, который узел сообщит в ответ на `eth_chainId`.
   * Если не задан, возвращается заявленный в конфигурации.
   */
  readonly reportedChainId?: ChainId

  /** Имитировать полную недоступность узлов. */
  readonly unavailable?: boolean

  /** Баланс, возвращаемый `getBalance`. Без него метод отвечает отказом. */
  readonly balance?: Wei

  /**
   * Проверять chainId при создании, как это делает `RpcClientFactory`.
   *
   * По умолчанию выключено: `NetworkService` сверяет идентификатор сам,
   * уже после создания соединения, и ему нужен провайдер, отвечающий
   * чужим значением.
   *
   * Включённая проверка воспроизводит поведение боевой фабрики целиком,
   * включая заворачивание причины: наружу выходит `ProviderUnavailableError`
   * с `cause` в виде `ChainIdMismatchError`. Без такой точности тест
   * не заметил бы, что настоящая причина отказа потеряна по дороге.
   */
  readonly verifyChainIdOnCreate?: boolean

  /** Данные о комиссии. Без них возвращаются значения работающей сети. */
  readonly feeData?: IFeeData

  /** Причина отказа при публикации транзакции. Без неё публикация удаётся. */
  readonly sendError?: string

  /** Журнальные записи, доступные выборке. По умолчанию их нет. */
  readonly logs?: readonly ILogEntry[]

  /**
   * Номер последнего блока.
   *
   * Влияет на диапазон выборки журналов: источник истории просматривает
   * окно, отсчитанное от последнего блока назад.
   */
  readonly latestBlock?: bigint

  /** Адреса, по которым `getCode` вернёт байт-код. По умолчанию таких нет. */
  readonly contractAddresses?: readonly string[]

  /** Записи ENS. По умолчанию реестр пуст и отвечает нулями. */
  readonly ensRecords?: readonly IFakeEnsRecord[]
}

/**
 * Запись ENS в дублёре.
 *
 * ХРАНИТСЯ ИМЕНЕМ, А НЕ УЗЛОМ. Дублёр вычисляет `namehash` тем же кодом,
 * что и боевой сервис, и отвечает на запрос по узлу. Ошибка в реализации
 * namehash из-за этого приводит к падению теста, а не к совпадению
 * двух одинаково неверных значений.
 */
export interface IFakeEnsRecord {
  /** Нормализованное имя, каким его увидит реестр. */
  readonly name: string

  /**
   * Адрес из записи `addr`. `null` означает «резолвер есть, записи нет».
   */
  readonly address: string | null

  /**
   * Адрес, у которого эта запись объявлена обратной.
   *
   * Задаётся отдельно от `address` намеренно: обратная запись
   * не проверяется никем, и тест обязан уметь описать расхождение —
   * адрес объявляет имя, которое на него не указывает.
   */
  readonly reverseFor?: string
}

/** Адрес резолвера, который выдаёт дублёр. Значение произвольно и постоянно. */
const FAKE_RESOLVER = toAddress(`0x${'11'.repeat(20)}`)

/** Слово ABI из тридцати двух нулевых байт. */
const ZERO_WORD = '0'.repeat(64)

/** Кодирует адрес словом ABI. */
function encodeAddressWord(address: string): HexString {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as HexString
}

/** Кодирует строку по правилам ABI: смещение, длина, содержимое. */
function encodeStringResult(value: string): HexString {
  const bytes = new TextEncoder().encode(value)

  let content = ''

  for (const byte of bytes) {
    content += byte.toString(16).padStart(2, '0')
  }

  const padded = content.padEnd(Math.ceil(content.length / 64) * 64, '0')
  const offset = (32).toString(16).padStart(64, '0')
  const length = bytes.length.toString(16).padStart(64, '0')

  return `0x${offset}${length}${padded}` as HexString
}

/**
 * Отвечает на вызов реестра либо резолвера ENS.
 *
 * @returns `null`, если вызов к ENS отношения не имеет.
 */
function answerEnsCall(
  request: ICallRequest,
  records: readonly IFakeEnsRecord[],
): HexString | null {
  const data = request.data ?? '0x'
  const node = `0x${data.slice(10)}`

  if (areAddressesEqual(request.to, ENS_REGISTRY_ADDRESS)) {
    if (!data.startsWith(`0x${ENS_RESOLVER_SELECTOR}`)) {
      return null
    }

    /* Резолвер выдаётся и прямому узлу имени, и обратному узлу адреса:
       и то и другое зарегистрировано, если про них есть запись. */
    const known =
      records.some((record) => namehash(record.name) === node) ||
      records.some(
        (record) =>
          record.reverseFor !== undefined && reverseNode(toAddress(record.reverseFor)) === node,
      )

    return known ? encodeAddressWord(FAKE_RESOLVER) : (`0x${ZERO_WORD}` as HexString)
  }

  if (!areAddressesEqual(request.to, FAKE_RESOLVER)) {
    return null
  }

  if (data.startsWith(`0x${ENS_ADDR_SELECTOR}`)) {
    const record = records.find((entry) => namehash(entry.name) === node)

    return record?.address == null
      ? (`0x${ZERO_WORD}` as HexString)
      : encodeAddressWord(record.address)
  }

  if (data.startsWith(`0x${ENS_NAME_SELECTOR}`)) {
    const record = records.find(
      (entry) =>
        entry.reverseFor !== undefined && reverseNode(toAddress(entry.reverseFor)) === node,
    )

    return record === undefined ? (`0x${ZERO_WORD}` as HexString) : encodeStringResult(record.name)
  }

  return null
}

/** Подходит ли журнальная запись под условия выборки. */
function matchesFilter(entry: ILogEntry, filter: ILogFilter): boolean {
  if (filter.fromBlock !== undefined && entry.blockNumber < filter.fromBlock) {
    return false
  }

  if (filter.toBlock !== undefined && entry.blockNumber > filter.toBlock) {
    return false
  }

  if (
    filter.address !== undefined &&
    filter.address.toLowerCase() !== entry.address.toLowerCase()
  ) {
    return false
  }

  return (filter.topics ?? []).every(
    (topic, position) =>
      topic === null || topic.toLowerCase() === entry.topics[position]?.toLowerCase(),
  )
}

/**
 * Хэш, возвращаемый при публикации.
 *
 * Постоянный: тесты проверяют, что значение доходит до интерфейса,
 * а не какое именно оно.
 */
const FAKE_TX_HASH = `0x${'ab'.repeat(32)}` as TxHash

/** Фабрика провайдеров-дублёров. */
export class FakeProviderFactory implements IProviderFactory {
  #options: IFakeProviderOptions = {}

  /** Число созданных провайдеров. Позволяет проверить, что соединение закрывается. */
  createdCount = 0

  /** Последний созданный провайдер. Используется для проверки вызова destroy. */
  lastProvider: IProvider | null = null

  configure(options: IFakeProviderOptions): void {
    this.#options = options
  }

  create(network: INetworkConfig): Promise<IProvider> {
    if (this.#options.unavailable === true) {
      return Promise.reject(new ProviderUnavailableError(network.chainId))
    }

    const reportedChainId = this.#options.reportedChainId ?? network.chainId

    if (this.#options.verifyChainIdOnCreate === true && reportedChainId !== network.chainId) {
      return Promise.reject(
        new ProviderUnavailableError(network.chainId, {
          cause: new ChainIdMismatchError(network.chainId, reportedChainId),
        }),
      )
    }

    const provider = new FakeProvider(
      network.chainId,
      reportedChainId,
      () => this.#options.balance ?? null,
      () => this.#options.feeData ?? null,
      () => this.#options.sendError ?? null,
      () => this.#options.logs ?? [],
      () => this.#options.latestBlock ?? 0n,
      () => this.#options.contractAddresses ?? [],
      () => this.#options.ensRecords ?? [],
    )

    this.createdCount += 1
    this.lastProvider = provider

    return Promise.resolve(provider)
  }
}
