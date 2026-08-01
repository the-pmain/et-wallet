import {
  EventBus,
  type Address,
  type ChainId,
  type DappResponse,
  type IDappRequest,
  type IDappSession,
  type ISessionTransport,
  type SessionTransportEventMap,
} from '@/core'

/** Ответ, отправленный приложению. */
export interface ISentResponse {
  readonly requestId: string
  readonly response: DappResponse
}

/**
 * Транспорт-дублёр.
 *
 * Позволяет проверить весь путь подключения — предложение, запрос,
 * подтверждение, отказ, отключение — без relay-сервера, без ключа
 * стороннего сервиса и без сети. Именно здесь проверяются решения,
 * от которых зависит сохранность средств.
 */
export class FakeSessionTransport implements ISessionTransport {
  readonly id = 'fake'
  readonly name = 'Дублёр подключений'

  readonly #events = new EventBus<SessionTransportEventMap>()

  /** Ответы, отправленные приложению. */
  readonly responses: ISentResponse[] = []

  /** Разорванные подключения. */
  readonly disconnected: string[] = []

  /** Ответы на предложения: `null` означает отказ. */
  readonly proposalAnswers: (readonly [string, unknown])[] = []

  /** Строки приглашений, по которым выполнялось подключение. */
  readonly pairings: string[] = []

  #sessions: IDappSession[] = []

  /** Причина отказа при инициализации. Без неё транспорт поднимается. */
  initError: string | null = null

  init(): Promise<void> {
    return this.initError === null ? Promise.resolve() : Promise.reject(new Error(this.initError))
  }

  pair(uri: string): Promise<void> {
    this.pairings.push(uri)

    return Promise.resolve()
  }

  respondToProposal(proposalId: string, approval: unknown): Promise<void> {
    this.proposalAnswers.push([proposalId, approval])

    return Promise.resolve()
  }

  respondToRequest(requestId: string, response: DappResponse): Promise<void> {
    this.responses.push({ requestId, response })

    return Promise.resolve()
  }

  listSessions(): readonly IDappSession[] {
    return this.#sessions
  }

  disconnect(sessionId: string): Promise<void> {
    this.disconnected.push(sessionId)
    this.#sessions = this.#sessions.filter((session) => session.id !== sessionId)
    this.#events.emit('session:disconnected', { sessionId })

    return Promise.resolve()
  }

  on = this.#events.on.bind(this.#events)

  destroy(): Promise<void> {
    return Promise.resolve()
  }

  /* --- Управление из теста --- */

  /** Задаёт действующие подключения. */
  setSessions(sessions: readonly IDappSession[]): void {
    this.#sessions = [...sessions]
  }

  /** Присылает предложение подключения. */
  emitProposal(id: string, chainIds: readonly ChainId[], name = 'Пример'): void {
    this.#events.emit('session:proposal', {
      id,
      dapp: { name, url: 'https://example.com', description: null, iconUrl: null },
      chainIds,
    })
  }

  /** Присылает запрос на подпись. */
  emitRequest(request: IDappRequest): void {
    this.#events.emit('session:request', { request })
  }

  /** Сообщает об установленном подключении. */
  emitConnected(session: IDappSession): void {
    this.#sessions = [...this.#sessions, session]
    this.#events.emit('session:connected', { session })
  }

  /** Адреса последнего одобренного предложения. */
  lastApprovedAddresses(): readonly Address[] {
    const last = this.proposalAnswers.at(-1)?.[1]

    if (last === null || typeof last !== 'object') {
      return []
    }

    return (last as { addresses?: readonly Address[] }).addresses ?? []
  }
}
