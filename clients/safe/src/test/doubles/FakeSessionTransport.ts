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

export interface ISentResponse {
  readonly requestId: string
  readonly response: DappResponse
}

/**
 * Transport double.
 *
 * Lets a test cover the whole connection path — proposal, request,
 * approve, reject, disconnect — without a relay server, a third-party
 * key, or a network. This is where decisions that affect the safety
 * of funds are checked.
 */
export class FakeSessionTransport implements ISessionTransport {
  readonly id = 'fake'
  readonly name = 'Connection double'

  readonly #events = new EventBus<SessionTransportEventMap>()

  readonly responses: ISentResponse[] = []

  readonly disconnected: string[] = []

  /** Answers to proposals: `null` means reject. */
  readonly proposalAnswers: (readonly [string, unknown])[] = []

  readonly pairings: string[] = []

  readonly stateChanges: { chainId: ChainId; addresses: readonly Address[] }[] = []

  #sessions: IDappSession[] = []

  /** Init failure reason. Without it the transport starts. */
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

  notifyStateChange(chainId: ChainId, addresses: readonly Address[]): Promise<void> {
    this.stateChanges.push({ chainId, addresses })

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

  setSessions(sessions: readonly IDappSession[]): void {
    this.#sessions = [...sessions]
  }

  emitProposal(id: string, chainIds: readonly ChainId[], name = 'Example'): void {
    this.#events.emit('session:proposal', {
      id,
      dapp: { name, url: 'https://example.com', description: null, iconUrl: null },
      chainIds,
    })
  }

  emitRequest(request: IDappRequest): void {
    this.#events.emit('session:request', { request })
  }

  emitConnected(session: IDappSession): void {
    this.#sessions = [...this.#sessions, session]
    this.#events.emit('session:connected', { session })
  }

  lastApprovedAddresses(): readonly Address[] {
    const last = this.proposalAnswers.at(-1)?.[1]

    if (last === null || typeof last !== 'object') {
      return []
    }

    return (last as { addresses?: readonly Address[] }).addresses ?? []
  }
}
