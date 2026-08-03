import {
  DAPP_REQUEST_KIND,
  findDappRisks,
  isKnownSender,
  type Address,
  type ChainId,
  type IDappRequest,
  type IDappRiskFinding,
  type IDappSession,
  type ILogger,
  type ISessionTransport,
  type Unsubscribe,
} from '@/core'

/** Предложение подключения, ожидающее решения. */
export interface IPendingProposal {
  readonly id: string
  readonly dapp: IDappSession['dapp']
  readonly chainIds: readonly ChainId[]
}

/** Запрос вместе с разбором его последствий. */
export interface IPendingRequest {
  readonly request: IDappRequest
  readonly risks: readonly IDappRiskFinding[]
}

/** Снимок состояния подключений для интерфейса. */
export interface IDappSnapshot {
  readonly isReady: boolean

  /** Причина, по которой транспорт недоступен. `null`, если доступен. */
  readonly error: string | null

  readonly sessions: readonly IDappSession[]

  /** Предложение, ожидающее решения. Одно за раз: очередь запутала бы. */
  readonly proposal: IPendingProposal | null

  readonly request: IPendingRequest | null
}

/** Пустой снимок. Отдельная константа ради стабильности ссылки. */
const EMPTY_SNAPSHOT: IDappSnapshot = {
  isReady: false,
  error: null,
  sessions: [],
  proposal: null,
  request: null,
}

/** Зависимости сервиса. */
export interface IDappSessionServiceDependencies {
  readonly transport: ISessionTransport
  readonly logger: ILogger

  /** Адреса кошелька, доступные приложениям. */
  readonly getAddresses: () => readonly Address[]

  /** Активная сеть кошелька. Нужна для сверки с сетью запроса. */
  readonly getActiveChainId: () => ChainId | null

  /** Сети, которые кошелёк готов предоставить приложению. */
  readonly getAvailableChainIds: () => readonly ChainId[]

  /** Выполняет одобренный запрос и возвращает результат для приложения. */
  readonly execute: (request: IDappRequest) => Promise<string>
}

/**
 * Подключения к приложениям.
 *
 * ОДНО ПРЕДЛОЖЕНИЕ И ОДИН ЗАПРОС ЗА РАЗ. Очередь из наложенных друг
 * на друга экранов подтверждения — это способ подписать не то: человек
 * отвечает на верхний, а подтверждает нижний. Пришедшее вторым
 * отклоняется с внятной причиной, и приложение вправе повторить.
 *
 * ЗАПРОС ОТ ЧУЖОГО ИМЕНИ ОТКЛОНЯЕТСЯ БЕЗ ВОПРОСА К ПОЛЬЗОВАТЕЛЮ.
 * Подписать транзакцию с чужим отправителем всё равно нечем, а лишний
 * экран приучает нажимать «подтвердить», не читая.
 *
 * СЕРВИС НЕ ПОДПИСЫВАЕТ САМ. Выполнение одобренного запроса передано
 * снаружи: ключи живут в сессии кошелька, и второй путь к ним
 * означал бы вторую точку отказа.
 */
export class DappSessionService {
  readonly #transport: ISessionTransport
  readonly #logger: ILogger
  readonly #dependencies: IDappSessionServiceDependencies
  readonly #listeners = new Set<() => void>()
  readonly #subscriptions: Unsubscribe[] = []

  #snapshot: IDappSnapshot = EMPTY_SNAPSHOT

  /** Попытка подъёма транспорта уже выполнялась. */
  #hasAttempted = false

  constructor(dependencies: IDappSessionServiceDependencies) {
    this.#transport = dependencies.transport
    this.#logger = dependencies.logger.child('DappSessions')
    this.#dependencies = dependencies
  }

  getSnapshot(): IDappSnapshot {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Поднимает транспорт.
   *
   * Отказ не выбрасывается наружу: раздел подключений обязан открыться
   * и объяснить, почему он не работает, а не остаться пустым экраном.
   */
  async init(): Promise<void> {
    /*
      Повторная попытка после отказа не выполняется автоматически.

      Транспорт отказывает по причинам, которые сами не проходят:
      не задан ключ проекта, нет сети. Повтор при каждом обращении
      превратился бы в бесконечный круг попыток, а вместе с ним —
      в подвисающий экран.
    */
    if (this.#snapshot.isReady || this.#hasAttempted) {
      return
    }

    this.#hasAttempted = true

    try {
      await this.#transport.init()
      this.#listen()

      this.#publish({
        ...this.#snapshot,
        isReady: true,
        error: null,
        sessions: this.#transport.listSessions(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The connection transport is unavailable', { reason: message })
      this.#publish({ ...this.#snapshot, isReady: false, error: message })
    }
  }

  /** Подключается по строке приглашения. */
  async pair(uri: string): Promise<void> {
    await this.#transport.pair(uri.trim())
  }

  /** Отвечает на предложение подключения. */
  async respondToProposal(isApproved: boolean): Promise<void> {
    const proposal = this.#snapshot.proposal

    if (proposal === null) {
      return
    }

    this.#publish({ ...this.#snapshot, proposal: null })

    if (!isApproved) {
      await this.#transport.respondToProposal(proposal.id, null)

      return
    }

    /*
      Приложению выдаются только те сети, которые есть в кошельке.
      Согласиться на неизвестную сеть значило бы пообещать подпись
      там, где кошелёк не может ни оценить комиссию, ни показать
      баланс.
    */
    const available = this.#dependencies.getAvailableChainIds()
    const chainIds = proposal.chainIds.filter((chainId) => available.includes(chainId))

    await this.#transport.respondToProposal(proposal.id, {
      addresses: this.#dependencies.getAddresses(),
      chainIds: chainIds.length === 0 ? available.slice(0, 1) : chainIds,
    })

    this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
  }

  /** Отвечает на запрос подписи. */
  async respondToRequest(isApproved: boolean): Promise<void> {
    const pending = this.#snapshot.request

    if (pending === null) {
      return
    }

    this.#publish({ ...this.#snapshot, request: null })

    if (!isApproved) {
      await this.#transport.respondToRequest(pending.request.id, {
        kind: 'rejected',
        reason: 'Rejected by the user',
      })

      return
    }

    try {
      const result = await this.#dependencies.execute(pending.request)

      await this.#transport.respondToRequest(pending.request.id, {
        kind: 'approved',
        result: result as never,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The application request could not be carried out', { reason: message })

      /* Приложению отправляется отказ, а не молчание: иначе оно ждёт
         ответа и подталкивает пользователя нажать ещё раз. */
      await this.#transport.respondToRequest(pending.request.id, {
        kind: 'rejected',
        reason: message,
      })
    }
  }

  /** Разрывает подключение. */
  async disconnect(sessionId: string): Promise<void> {
    await this.#transport.disconnect(sessionId)

    this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
  }

  /** Закрывает транспорт и сбрасывает состояние. */
  async destroy(): Promise<void> {
    for (const unsubscribe of this.#subscriptions) {
      unsubscribe()
    }

    this.#subscriptions.length = 0

    await this.#transport.destroy()

    /* Признак попытки сбрасывается вместе с состоянием: следующее
       открытие раздела вправе попробовать снова. */
    this.#hasAttempted = false
    this.#publish(EMPTY_SNAPSHOT)
  }

  /** Подписывается на события транспорта. */
  #listen(): void {
    this.#subscriptions.push(
      this.#transport.on('session:proposal', (proposal) => {
        this.#publish({ ...this.#snapshot, proposal })
      }),

      this.#transport.on('session:connected', () => {
        this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
      }),

      this.#transport.on('session:disconnected', () => {
        this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
      }),

      this.#transport.on('session:request', ({ request }) => {
        void this.#acceptRequest(request)
      }),
    )
  }

  /** Принимает запрос к показу либо отклоняет его сразу. */
  async #acceptRequest(request: IDappRequest): Promise<void> {
    if (this.#snapshot.request !== null) {
      /* Второй экран поверх первого — способ подписать не то. */
      await this.#transport.respondToRequest(request.id, {
        kind: 'rejected',
        reason: 'The wallet is busy with another request',
      })

      return
    }

    const payload = request.payload
    const sender =
      payload.kind === DAPP_REQUEST_KIND.SignMessage ||
      payload.kind === DAPP_REQUEST_KIND.SignTypedData
        ? payload.address
        : payload.transaction.from

    if (!isKnownSender(sender, this.#dependencies.getAddresses())) {
      /* Подписать чужим адресом всё равно нечем; лишний экран приучает
         нажимать «подтвердить», не читая. */
      await this.#transport.respondToRequest(request.id, {
        kind: 'rejected',
        reason: 'The request targets an account that does not exist in this wallet',
      })

      return
    }

    this.#publish({
      ...this.#snapshot,
      request: {
        request,
        risks: findDappRisks(request, this.#dependencies.getActiveChainId()),
      },
    })
  }

  #publish(snapshot: IDappSnapshot): void {
    this.#snapshot = snapshot

    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}
