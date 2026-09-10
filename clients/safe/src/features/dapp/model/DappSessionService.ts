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
  type IPreflightResult,
  type ISessionTransport,
  type Unsubscribe,
} from '@/core'

export interface IPendingProposal {
  readonly id: string
  readonly dapp: IDappSession['dapp']
  readonly chainIds: readonly ChainId[]
}

export interface IPendingRequest {
  readonly request: IDappRequest
  readonly risks: readonly IDappRiskFinding[]

  /**
   * Result of running the call on the node.
   *
   * `null` — the run is still going. THE SCREEN DOES NOT WAIT FOR IT:
   * confirmation is shown at once, and the result arrives as a later
   * update. If the screen paused for the node, the person would think
   * the wallet had hung and press again in the app.
   */
  readonly preflight: IPreflightResult | null
}

export interface IDappSnapshot {
  readonly isReady: boolean

  /** Why the transport is unavailable. `null` if it is available. */
  readonly error: string | null

  readonly sessions: readonly IDappSession[]

  /** Proposal awaiting a decision. One at a time: a queue would confuse. */
  readonly proposal: IPendingProposal | null

  readonly request: IPendingRequest | null
}

/** Empty snapshot. A separate constant so the reference stays stable. */
const EMPTY_SNAPSHOT: IDappSnapshot = {
  isReady: false,
  error: null,
  sessions: [],
  proposal: null,
  request: null,
}

export interface IDappSessionServiceDependencies {
  readonly transport: ISessionTransport
  readonly logger: ILogger

  readonly getAddresses: () => readonly Address[]

  /** Active wallet network. Used to compare with the request network. */
  readonly getActiveChainId: () => ChainId | null

  readonly getAvailableChainIds: () => readonly ChainId[]

  readonly execute: (request: IDappRequest) => Promise<string>

  /**
   * Runs the request transaction on the node before signing.
   *
   * Optional: connections work where there is no node. Its absence
   * means "not checked" and is shown that way.
   */
  readonly preflight?: (request: IDappRequest) => Promise<IPreflightResult>
}

/**
 * Connections to applications.
 *
 * ONE PROPOSAL AND ONE REQUEST AT A TIME. A stack of confirmation
 * screens is a way to sign the wrong thing: the person answers the
 * top one and confirms the bottom. A second arrival is rejected with
 * a clear reason, and the app may retry.
 *
 * A REQUEST IN SOMEONE ELSE'S NAME IS REJECTED WITHOUT ASKING.
 * There is nothing to sign a foreign sender with, and an extra
 * screen trains people to press "confirm" without reading.
 *
 * THE SERVICE DOES NOT SIGN ITSELF. Execution of an approved request
 * is injected: keys live in the wallet session, and a second path
 * to them would be a second point of failure.
 */
export class DappSessionService {
  readonly #transport: ISessionTransport
  readonly #logger: ILogger
  readonly #dependencies: IDappSessionServiceDependencies
  readonly #listeners = new Set<() => void>()
  readonly #subscriptions: Unsubscribe[] = []

  #snapshot: IDappSnapshot = EMPTY_SNAPSHOT

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
   * Starts the transport.
   *
   * Failure is not thrown outward: the connections section must open
   * and explain why it does not work, not stay a blank screen.
   */
  async init(): Promise<void> {
    /*
      A retry after failure is not automatic.

      The transport fails for reasons that do not heal themselves:
      missing project key, no network. Retrying on every call would
      become an endless loop and a hung screen.
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

  async pair(uri: string): Promise<void> {
    await this.#transport.pair(uri.trim())
  }

  /**
   * Tells connected apps the wallet's current network and account.
   *
   * CALLED ON WALLET STATE CHANGE, not on a timer: the event must
   * coincide with the owner's action, or the app learns of the switch
   * late and prepares an operation for the previous network.
   *
   * DOES NOTHING UNTIL THE TRANSPORT IS READY AND THERE IS AN ACTIVE
   * NETWORK: there is no one and nothing to notify.
   */
  async notifyWalletState(): Promise<void> {
    if (!this.#snapshot.isReady) {
      return
    }

    const chainId = this.#dependencies.getActiveChainId()

    if (chainId === null) {
      return
    }

    try {
      await this.#transport.notifyStateChange(chainId, this.#dependencies.getAddresses())
    } catch (error) {
      /* Notification is a convenience, not a funds operation: its
         failure must not surface as a wallet error. The reason goes
         to the log. */
      this.#logger.warn('Connected applications could not be notified of the state change', {
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
      The app is given only networks the wallet has. Agreeing to an
      unknown network would promise a signature where the wallet
      cannot estimate a fee or show a balance.
    */
    const available = this.#dependencies.getAvailableChainIds()
    const chainIds = proposal.chainIds.filter((chainId) => available.includes(chainId))

    await this.#transport.respondToProposal(proposal.id, {
      addresses: this.#dependencies.getAddresses(),
      chainIds: chainIds.length === 0 ? available.slice(0, 1) : chainIds,
    })

    this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
  }

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

      /* The app is sent a rejection, not silence: otherwise it waits
         and nudges the user to press again. */
      await this.#transport.respondToRequest(pending.request.id, {
        kind: 'rejected',
        reason: message,
      })
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.#transport.disconnect(sessionId)

    this.#publish({ ...this.#snapshot, sessions: this.#transport.listSessions() })
  }

  async destroy(): Promise<void> {
    for (const unsubscribe of this.#subscriptions) {
      unsubscribe()
    }

    this.#subscriptions.length = 0

    await this.#transport.destroy()

    /* The attempt flag is cleared with state: the next open of the
       section may try again. */
    this.#hasAttempted = false
    this.#publish(EMPTY_SNAPSHOT)
  }

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

  async #acceptRequest(request: IDappRequest): Promise<void> {
    if (this.#snapshot.request !== null) {
      /* A second screen on top of the first is a way to sign the wrong thing. */
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
      /* There is nothing to sign a foreign address with; an extra
         screen trains people to press "confirm" without reading. */
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
        preflight: null,
      },
    })

    void this.#runPreflight(request)
  }

  /**
   * Runs the request call and attaches the result to the shown screen.
   *
   * THE RESULT IS APPLIED ONLY TO THE SAME REQUEST. While the node
   * answered, the user may have rejected it and the app sent another;
   * a check of a foreign call shown next to a new one would be a
   * direct lie.
   */
  async #runPreflight(request: IDappRequest): Promise<void> {
    const preflight = this.#dependencies.preflight

    if (preflight === undefined || request.payload.kind !== DAPP_REQUEST_KIND.SendTransaction) {
      return
    }

    let result: IPreflightResult

    try {
      result = await preflight(request)
    } catch (error) {
      this.#dependencies.logger.warn('The dapp call could not be checked before signing', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return
    }

    const pending = this.#snapshot.request

    if (pending === null || pending.request.id !== request.id) {
      return
    }

    this.#publish({ ...this.#snapshot, request: { ...pending, preflight: result } })
  }

  #publish(snapshot: IDappSnapshot): void {
    this.#snapshot = snapshot

    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}
