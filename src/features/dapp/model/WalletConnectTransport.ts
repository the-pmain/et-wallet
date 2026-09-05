import {
  chainIdToHex,
  toAddress,
  toChainId,
  type Address,
  type ChainId,
  type DappResponse,
  type HexString,
  type IDappRequest,
  type IDappSession,
  type ILogger,
  type ISessionTransport,
  type SessionTransportEventMap,
} from '@/core'

import { parseCaip2, toCaip2, toCaip10 } from './caip'
import type { IKeyValueStorage } from './SessionStorage'
import { toDappRequest } from './request-mapping'
import { TransportEvents } from './TransportEvents'

const TRANSPORT_ID = 'walletconnect'
const TRANSPORT_NAME = 'WalletConnect'

/**
 * CAIP-2 namespace for EVM networks.
 *
 * The wallet works only with these: claiming another chain would
 * promise a signature with a key we do not have.
 */
const EVM_NAMESPACE = 'eip155'

/**
 * Methods the wallet can perform.
 *
 * `eth_sign` IS OMITTED ON PURPOSE. It signs arbitrary 32 bytes
 * without a prefix, so an app can obtain a signature under a
 * transaction hash without showing the owner anything. Claiming a
 * method we reject at execution would let the app build on it and
 * get a refusal at the worst moment.
 */
const SUPPORTED_METHODS: readonly string[] = [
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'eth_signTransaction',
]

const SUPPORTED_EVENTS: readonly string[] = ['accountsChanged', 'chainChanged']

export interface IWalletConnectOptions {
  /** Reown (WalletConnect Cloud) project id. Without it the relay refuses. */
  readonly projectId: string

  readonly metadata: {
    readonly name: string
    readonly description: string
    readonly url: string
    readonly icons: readonly string[]
  }

  readonly logger: ILogger

  /**
   * Connection-state storage.
   *
   * Optional: without it the library uses `localStorage`, and sessions
   * do not survive reload — we cannot write there; the linter forbids
   * that path. Passed from the app composition so the transport does
   * not know how the stored data is encrypted.
   */
  readonly storage?: IKeyValueStorage
}

/**
 * Connect to applications via WalletConnect v2.
 *
 * LOADED LAZILY. The library is about three megabytes unpacked;
 * loading it at start would make the password screen wait for code
 * that may never be needed. The import happens in `init`, on the
 * first visit to the connections section.
 *
 * WHAT THE RELAY SERVER SEES. The wallet address, each app's
 * metadata, and the time of each request. That is indexer-level
 * leakage, so connections start on an explicit user action, not
 * by themselves.
 *
 * THE TRANSPORT DOES NOT DECIDE. It turns relay messages into
 * core-shaped requests and sends back what the user decided.
 * Risk scoring, display, and confirmation live above.
 */
export class WalletConnectTransport implements ISessionTransport {
  readonly id = TRANSPORT_ID
  readonly name = TRANSPORT_NAME

  readonly #options: IWalletConnectOptions
  readonly #logger: ILogger
  readonly #events = new TransportEvents()

  /* The client type is not imported at the top level: that would
     pull the library into the main chunk and cancel lazy loading. */
  #client: WalletConnectClient | null = null

  constructor(options: IWalletConnectOptions) {
    this.#options = options
    this.#logger = options.logger.child(TRANSPORT_NAME)
  }

  async init(): Promise<void> {
    if (this.#client !== null) {
      return
    }

    if (this.#options.projectId === '') {
      throw new Error(
        'WalletConnect is not configured: the project identifier is missing. ' +
          'Connecting to applications is unavailable; the rest of the wallet works.',
      )
    }

    const { default: SignClient } = await import('@walletconnect/sign-client')

    const storage = this.#options.storage

    const client = (await SignClient.init({
      projectId: this.#options.projectId,
      metadata: { ...this.#options.metadata, icons: [...this.#options.metadata.icons] },
      /* WITHOUT THIS THE LIBRARY WRITES TO `localStorage`. The linter
         forbids it and it is not encrypted: session keys would sit
         there in plaintext. No storage would mean connections that
         live only until the first reload. */
      ...(storage === undefined ? {} : { storage }),
    })) as unknown as WalletConnectClient

    this.#subscribe(client)
    this.#client = client

    this.#logger.info('The connection transport is ready', { sessions: this.listSessions().length })
  }

  async pair(uri: string): Promise<void> {
    await this.#requireClient().core.pairing.pair({ uri })
  }

  async respondToProposal(
    proposalId: string,
    approval: {
      readonly addresses: readonly Address[]
      readonly chainIds: readonly ChainId[]
    } | null,
  ): Promise<void> {
    const client = this.#requireClient()
    const id = Number(proposalId)

    if (approval === null) {
      /* Rejection is sent explicitly: an app that gets no reply hangs
         waiting and nudges the user to press again. */
      await client.reject({ id, reason: { code: 5000, message: 'Rejected by the user' } })

      return
    }

    const accounts = approval.chainIds.flatMap((chainId) =>
      approval.addresses.map((address) => toCaip10(chainId, address)),
    )

    await client.approve({
      id,
      namespaces: {
        [EVM_NAMESPACE]: {
          accounts,
          chains: approval.chainIds.map((chainId) => toCaip2(chainId)),
          methods: [...SUPPORTED_METHODS],
          events: [...SUPPORTED_EVENTS],
        },
      },
    })
  }

  async respondToRequest(requestId: string, response: DappResponse): Promise<void> {
    const client = this.#requireClient()
    const [topic = '', rawId = ''] = requestId.split('|')

    await client.respond({
      topic,
      response:
        response.kind === 'approved'
          ? { id: Number(rawId), jsonrpc: '2.0', result: response.result }
          : {
              id: Number(rawId),
              jsonrpc: '2.0',
              /* Code 4001 is a user rejection per EIP-1193. Apps
                 recognize it and do not treat it as a link failure. */
              error: { code: 4001, message: response.reason },
            },
    })
  }

  async notifyStateChange(chainId: ChainId, addresses: readonly Address[]): Promise<void> {
    const client = this.#client

    if (client === null) {
      return
    }

    for (const emission of buildStateChangeEmissions(client.session.getAll(), chainId, addresses)) {
      try {
        await client.emit(emission)
      } catch (error) {
        /* Failure of one connection must not starve the others of
           notification: the reason goes to the log, the loop continues. */
        this.#logger.warn('An application could not be notified of the state change', {
          topic: emission.topic,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  listSessions(): readonly IDappSession[] {
    if (this.#client === null) {
      return []
    }

    return this.#client.session.getAll().map((session) => toDappSession(session))
  }

  async disconnect(sessionId: string): Promise<void> {
    await this.#requireClient().disconnect({
      topic: sessionId,
      reason: { code: 6000, message: 'Disconnected by the user' },
    })

    this.#events.emit('session:disconnected', { sessionId })
  }

  on<TEvent extends keyof SessionTransportEventMap>(
    event: TEvent,
    listener: (payload: SessionTransportEventMap[TEvent]) => void,
  ): () => void {
    return this.#events.on(event, listener)
  }

  async destroy(): Promise<void> {
    /* The relay connection closes with the wallet lock: an open
       channel would keep telling the operator that the owner is
       at the device. */
    await this.#client?.core.relayer.transportClose()
    this.#client = null
  }

  #subscribe(client: WalletConnectClient): void {
    client.on('session_proposal', (event) => {
      this.#events.emit('session:proposal', {
        id: String(event.id),
        dapp: toMetadata(event.params.proposer.metadata),
        chainIds: readProposedChains(event.params),
      })
    })

    client.on('session_request', (event) => {
      const request = toDappRequest({
        topic: event.topic,
        id: event.id,
        chainId: parseCaip2(event.params.chainId),
        method: event.params.request.method,
        params: event.params.request.params,
        dapp: toMetadata(client.session.get(event.topic)?.peer.metadata),
      })

      if (request === null) {
        /* An unknown method is rejected, not skipped: signing what
           we do not parse is signing blind. */
        void this.respondToRequest(`${event.topic}|${String(event.id)}`, {
          kind: 'rejected',
          reason: 'The method is not supported by this wallet',
        })

        return
      }

      this.#events.emit('session:request', { request })
    })

    client.on('session_delete', (event) => {
      this.#events.emit('session:disconnected', { sessionId: event.topic })
    })
  }

  #requireClient(): WalletConnectClient {
    if (this.#client === null) {
      throw new Error('The connection transport is not initialised.')
    }

    return this.#client
  }
}

/**
 * Minimal client shape the transport uses.
 *
 * Declared here, not imported: importing the type from the library
 * would pull it into the main chunk and cancel lazy loading. The
 * set is narrow — exactly what is called below.
 */
interface WalletConnectClient {
  readonly core: {
    readonly pairing: { pair(params: { uri: string }): Promise<unknown> }
    readonly relayer: { transportClose(): Promise<void> }
  }
  readonly session: {
    getAll(): readonly RawSession[]
    get(topic: string): RawSession | undefined
  }
  approve(params: unknown): Promise<unknown>
  reject(params: unknown): Promise<void>
  respond(params: unknown): Promise<void>
  emit(params: {
    topic: string
    chainId: string
    event: { name: string; data: unknown }
  }): Promise<void>
  disconnect(params: unknown): Promise<void>
  on(event: 'session_proposal', listener: (event: RawProposal) => void): void
  on(event: 'session_request', listener: (event: RawRequest) => void): void
  on(event: 'session_delete', listener: (event: { topic: string }) => void): void
}

interface RawMetadata {
  readonly name?: string
  readonly url?: string
  readonly description?: string
  readonly icons?: readonly string[]
}

interface RawSession {
  readonly topic: string
  readonly expiry: number
  readonly peer: { readonly metadata: RawMetadata }
  readonly namespaces: Readonly<
    Record<string, { readonly accounts?: readonly string[]; readonly chains?: readonly string[] }>
  >
}

export interface IStateChangeEmission {
  readonly topic: string
  readonly chainId: string
  readonly event: { readonly name: string; readonly data: unknown }
}

/**
 * Build state-change events for every matching connection.
 *
 * EXTRACTED FROM THE TRANSPORT FOR TESTABILITY. The relay connection
 * itself cannot be stubbed, and this is where mistakes are easy:
 * CAIP format, hex network id, filter by approved networks.
 * A pure function is checked without the library.
 *
 * THE EVENT GOES ONLY TO SESSIONS THAT APPROVED THIS NETWORK.
 * Relay would reject an app that did not request it, and iterating
 * mismatched networks fills the log with false refusals.
 *
 * TWO EVENTS PER CONNECTION. `chainChanged` carries the network as
 * a hex string (EIP-1193); `accountsChanged` carries CAIP-10
 * addresses, the same form issued at connect. A bare address is
 * rejected by some apps.
 */
export function buildStateChangeEmissions(
  sessions: readonly RawSession[],
  chainId: ChainId,
  addresses: readonly Address[],
): readonly IStateChangeEmission[] {
  const caip2 = toCaip2(chainId)
  const accounts = addresses.map((address) => toCaip10(chainId, address))
  const emissions: IStateChangeEmission[] = []

  for (const session of sessions) {
    const approved = session.namespaces[EVM_NAMESPACE]?.chains ?? []

    if (!approved.includes(caip2)) {
      continue
    }

    emissions.push(
      {
        topic: session.topic,
        chainId: caip2,
        event: { name: 'chainChanged', data: chainIdToHex(chainId) },
      },
      {
        topic: session.topic,
        chainId: caip2,
        event: { name: 'accountsChanged', data: accounts },
      },
    )
  }

  return emissions
}

interface RawProposal {
  readonly id: number
  readonly params: {
    readonly proposer: { readonly metadata: RawMetadata }
    readonly requiredNamespaces?: Readonly<Record<string, { readonly chains?: readonly string[] }>>
    readonly optionalNamespaces?: Readonly<Record<string, { readonly chains?: readonly string[] }>>
  }
}

interface RawRequest {
  readonly topic: string
  readonly id: number
  readonly params: {
    readonly chainId: string
    readonly request: { readonly method: string; readonly params: unknown }
  }
}

function toMetadata(metadata: RawMetadata | undefined) {
  return {
    /* Empty values are not invented: an app that did not name itself
       must look nameless, not acquire someone else's name. */
    name: metadata?.name ?? '',
    url: metadata?.url ?? '',
    description: metadata?.description ?? null,
    iconUrl: metadata?.icons?.[0] ?? null,
  }
}

function readProposedChains(params: RawProposal['params']): readonly ChainId[] {
  const chains = [
    ...(params.requiredNamespaces?.[EVM_NAMESPACE]?.chains ?? []),
    ...(params.optionalNamespaces?.[EVM_NAMESPACE]?.chains ?? []),
  ]

  const unique = new Set(chains)

  return [...unique].map((chain) => parseCaip2(chain)).filter((chain) => chain !== null)
}

function toDappSession(session: RawSession): IDappSession {
  const accounts = session.namespaces[EVM_NAMESPACE]?.accounts ?? []
  const addresses: Address[] = []
  const chainIds: ChainId[] = []

  for (const account of accounts) {
    const parts = account.split(':')
    const rawChain = parts[1]
    const rawAddress = parts[2]

    if (rawChain === undefined || rawAddress === undefined) {
      continue
    }

    try {
      const address = toAddress(rawAddress)
      const chainId = toChainId(BigInt(rawChain))

      if (!addresses.some((item) => item === address)) {
        addresses.push(address)
      }

      if (!chainIds.includes(chainId)) {
        chainIds.push(chainId)
      }
    } catch {
      /* A corrupted entry is skipped: one unreadable row must not
         take away the whole connections list. */
    }
  }

  return {
    id: session.topic,
    dapp: toMetadata(session.peer.metadata),
    chainIds,
    addresses,
    connectedAt: 0,
    /* The library reports expiry in seconds. */
    expiresAt: session.expiry * 1000,
  }
}

export type SignatureResult = HexString

export type { IDappRequest }
