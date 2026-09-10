import { ProviderUnavailableError } from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import type { ILogger } from '@/core/platform'
import type { Address, BlockTag, ChainId, HexString, TxHash, Unsubscribe, Wei } from '@/core/types'

import type { IProvider } from './contracts'
import type { IRpcEndpoint } from './rpc-endpoint'
import type {
  ICallRequest,
  IGasEstimateRequest,
  IFeeData,
  ILogEntry,
  ILogFilter,
  IRpcRequest,
  ITransactionReceipt,
  ProviderEventMap,
} from './types'

const PROVIDER_NAME = 'FailoverProvider'

/**
 * Calls whose failure describes a node's capabilities, not the chain.
 *
 * Read-only: probing neighbors repeats the call on several nodes,
 * so a mutating action would execute more than once.
 *
 * `eth_simulateV1` is a newer method, and public-node support is uneven:
 * measured that the first Ethereum built-in endpoint does not implement
 * it, while the second does.
 */
const NODE_CAPABILITY_METHODS: ReadonlySet<string> = new Set(['eth_simulateV1'])

/** Connects to a single endpoint. Injected so this module does not own transport. */
export type EndpointConnector = (endpoint: IRpcEndpoint, chainId: ChainId) => Promise<IProvider>

/** Notified when the active node is replaced. */
export type EndpointSwitchListener = (
  failed: IRpcEndpoint,
  next: IRpcEndpoint | null,
  reason: string,
) => void

/** Provider dependencies. */
export interface IFailoverProviderDependencies {
  readonly chainId: ChainId
  readonly endpoints: readonly IRpcEndpoint[]
  readonly connect: EndpointConnector
  readonly logger: ILogger

  /** Called when an address is dropped from rotation. */
  readonly onSwitch?: EndpointSwitchListener
}

/**
 * Transport that survives a node failure.
 *
 * WHY. Backup-address rotation at connect time already existed, but it
 * ran exactly once. A node that failed a minute after connect doomed
 * every later call for the rest of the session: the wallet showed the
 * network as unavailable while two working backups sat in config.
 *
 * SWITCH ONLY ON TRANSPORT FAILURE. A JSON-RPC error response does not
 * trigger a switch: the node that answered is alive, and a second node
 * would answer the same. The distinction is essential —
 * `ProviderUnavailableError` means "no response", `RpcError` means
 * "a negative response was received".
 *
 * LOG QUERIES DO NOT CONSUME ROTATION. `eth_getLogs` is the only call
 * whose failure does not speak to node health: a node that is fine for
 * balance and nonce routinely refuses a wide log search. That failure
 * probes neighbors via temporary connections and does not replace the
 * active node. Details in `getLogs`.
 *
 * SAME FOR `NODE_CAPABILITY_METHODS`. Those depend on node features,
 * not chain state: measured that a node which serves logs refuses
 * simulation, and vice versa. Neighbor probing is the only way to have
 * both without rotating away from a working node.
 *
 * TRANSACTION SEND IS NOT RETRIED. `sendRawTransaction` fails on
 * transport error without trying another node. Not because of
 * idempotency — republishing the same signed bytes is safe — but because
 * the fate of the first send is unknown: the node may have accepted
 * the transaction and failed to reply. The second node would return
 * "already known", and the wallet would show a failure for a transaction
 * that was actually accepted. The user must learn about the uncertainty
 * rather than get an invented answer.
 *
 * EXHAUSTING THE LIST IS A FAILURE, NOT SILENCE. When no usable
 * addresses remain, calls throw `ProviderUnavailableError`.
 */
export class FailoverProvider implements IProvider {
  readonly chainId: ChainId

  readonly #endpoints: readonly IRpcEndpoint[]
  readonly #connect: EndpointConnector
  readonly #logger: ILogger
  readonly #onSwitch: EndpointSwitchListener | null
  readonly #events = new EventBus<ProviderEventMap>()

  #index = 0
  #current: IProvider | null = null
  #connecting: Promise<IProvider> | null = null
  #destroyed = false

  constructor(dependencies: IFailoverProviderDependencies) {
    this.chainId = dependencies.chainId
    this.#endpoints = dependencies.endpoints
    this.#connect = dependencies.connect
    this.#logger = dependencies.logger.child(PROVIDER_NAME)
    this.#onSwitch = dependencies.onSwitch ?? null
  }

  /** Active node URL. Empty string until a connection exists. */
  get rpcUrl(): string {
    return this.#current?.rpcUrl ?? ''
  }

  /**
   * Whether the provider can still serve calls.
   *
   * AN EXHAUSTED LIST IS UNFIT, NOT A SPECIAL STATE.
   * After every address is tried, the object stays alive but has nothing
   * to answer with: each call fails immediately without touching the
   * network. While such a provider was still treated as active, `RpcManager`
   * kept it in cache and handed it out — the wallet showed "network
   * unavailable" with healthy nodes, and nothing could fix that until reload.
   *
   * By reporting itself unfit, the provider lets `RpcManager` drop it
   * and build a new one: that rereads the address list and honors expired
   * cooldowns.
   */
  get isActive(): boolean {
    return !this.#destroyed && this.#index < this.#endpoints.length
  }

  /** Active endpoint with its source. `null` until a connection exists. */
  get activeEndpoint(): IRpcEndpoint | null {
    return this.#current === null ? null : (this.#endpoints[this.#index] ?? null)
  }

  /**
   * Arbitrary JSON-RPC call.
   *
   * `NODE_CAPABILITY_METHODS` ARE ASKED OF NEIGHBORS ON FAILURE.
   * Same reason as logs: failure means node capability, not chain state,
   * and a neighbor may answer differently. Measured on live nodes: a
   * gateway that serves logs refuses simulation, and a node that simulates
   * does not serve logs. Without neighbor probing, one of the two would
   * always stay unavailable.
   *
   * The active node is not replaced: it is healthy, it just cannot do
   * this particular call.
   */
  async request<TResult>(request: IRpcRequest): Promise<TResult> {
    if (!NODE_CAPABILITY_METHODS.has(request.method)) {
      return await this.#withFailover((provider) => provider.request<TResult>(request))
    }

    let firstError: unknown

    try {
      return await (await this.#ensureConnected()).request<TResult>(request)
    } catch (error) {
      firstError = error
    }

    return await this.#askElsewhere((provider) => provider.request<TResult>(request), firstError)
  }

  async getChainId(): Promise<ChainId> {
    return await this.#withFailover((provider) => provider.getChainId())
  }

  async getBlockNumber(): Promise<bigint> {
    return await this.#withFailover((provider) => provider.getBlockNumber())
  }

  async getBalance(address: Address, blockTag?: BlockTag): Promise<Wei> {
    return await this.#withFailover((provider) => provider.getBalance(address, blockTag))
  }

  async getTransactionCount(address: Address, blockTag?: BlockTag): Promise<number> {
    return await this.#withFailover((provider) => provider.getTransactionCount(address, blockTag))
  }

  async getNonce(address: Address): Promise<number> {
    return await this.#withFailover((provider) => provider.getNonce(address))
  }

  async call(request: ICallRequest, blockTag?: BlockTag): Promise<HexString> {
    return await this.#withFailover((provider) => provider.call(request, blockTag))
  }

  async getCode(address: Address, blockTag?: BlockTag): Promise<HexString> {
    return await this.#withFailover((provider) => provider.getCode(address, blockTag))
  }

  async estimateGas(request: IGasEstimateRequest): Promise<bigint> {
    return await this.#withFailover((provider) => provider.estimateGas(request))
  }

  async getFeeData(): Promise<IFeeData> {
    return await this.#withFailover((provider) => provider.getFeeData())
  }

  /**
   * Publishes a signed transaction WITHOUT retrying on another node.
   *
   * Rationale is in the class description.
   */
  async sendRawTransaction(signedTransaction: HexString): Promise<TxHash> {
    const provider = await this.#ensureConnected()

    return await provider.sendRawTransaction(signedTransaction)
  }

  async getTransactionReceipt(hash: TxHash): Promise<ITransactionReceipt | null> {
    return await this.#withFailover((provider) => provider.getTransactionReceipt(hash))
  }

  /**
   * Log query: asks neighbors but does NOT drop the active node.
   *
   * WHY THIS CALL IS HANDLED APART FROM THE REST. `eth_getLogs` is an
   * order of magnitude heavier than other requests, and its failure does
   * not mean the same as a balance failure. Measured on live nodes: during
   * a history search `eth.drpc.org` returned "408 Request Timeout" and
   * `ethereum-rpc.publicnode.com` returned "403: archive requests require
   * a personal token". Both nodes were serving balance, block number, and
   * nonce in the same second.
   *
   * Rule: a log failure condemns the request, not the node. Routing it
   * through general rotation would drop a node on every history visit,
   * and after two visits the wallet would have no connection at all —
   * no balances, no send. Observed live: the history screen reported
   * "no available addresses" without making a request, because the list
   * had already been exhausted.
   *
   * So: the active node is asked first and stays active regardless of
   * outcome; on failure the other addresses are probed via temporary
   * connections, without touching rotation.
   *
   * COST TO KNOW. The second node sees the same request: owner address
   * and topics. The cost is bounded — probing runs only after failure
   * and only against already configured addresses — but more than one
   * operator sees the query.
   */
  async getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    let firstError: unknown

    try {
      return await (await this.#ensureConnected()).getLogs(filter)
    } catch (error) {
      firstError = error
    }

    return await this.#askElsewhere((provider) => provider.getLogs(filter), firstError)
  }

  destroy(): void {
    this.#destroyed = true
    this.#current?.destroy()
    this.#current = null
    this.#connecting = null
  }

  on<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Runs a call, switching to the next address on transport failure.
   *
   * Each address is tried at most once per call: retrying an address
   * that already failed would only lengthen the wait.
   */
  async #withFailover<TResult>(call: (provider: IProvider) => Promise<TResult>): Promise<TResult> {
    let lastError: unknown = null

    while (this.#index < this.#endpoints.length) {
      const endpoint = this.#endpoints[this.#index] as IRpcEndpoint

      try {
        return await call(await this.#ensureConnected())
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) {
          /* The node answered, and the answer is negative. Another node
             would say the same: insufficient funds and a reverted call
             do not depend on whom you ask. */
          throw error
        }

        lastError = error
        this.#rotate(endpoint, error.message)
      }
    }

    throw new ProviderUnavailableError(this.chainId, { cause: lastError })
  }

  /**
   * Probes remaining addresses without changing the active node.
   *
   * Connections here are temporary and closed immediately: a one-shot
   * question to a neighbor, not a change of working channel. Walk order
   * is list order; the active address is skipped because it was already asked.
   *
   * READ-ONLY ONLY. The call goes to several nodes, so a mutating
   * action — sending a transaction — would execute more than once.
   *
   * @throws The original error if no neighbor answered. That error must
   *         surface: the last probed node's error would describe a
   *         random neighbor instead of the node the wallet is using.
   */
  async #askElsewhere<TResult>(
    call: (provider: IProvider) => Promise<TResult>,
    firstError: unknown,
  ): Promise<TResult> {
    for (const [index, endpoint] of this.#endpoints.entries()) {
      if (index === this.#index || this.#destroyed) {
        continue
      }

      let probe: IProvider

      try {
        probe = await this.#connect(endpoint, this.chainId)
      } catch {
        /* Neighbor unreachable. Does not affect the active node. */
        continue
      }

      try {
        return await call(probe)
      } catch {
        /* Neighbor refused too. Expected, not an incident: public nodes
           refuse wide searches all the time. Not logged — a line per
           history visit would become noise, and the original error
           already names the cause. */
        continue
      } finally {
        probe.destroy()
      }
    }

    throw firstError
  }

  /** Returns the active connection, establishing it if needed. */
  async #ensureConnected(): Promise<IProvider> {
    if (this.#destroyed) {
      throw new ProviderUnavailableError(this.chainId)
    }

    if (this.#current !== null && this.#current.isActive) {
      return this.#current
    }

    /* Concurrent calls share one connect: a screen that asks for
       balance and nonce at once would otherwise open two connections. */
    this.#connecting ??= this.#connectFromCurrentIndex()

    try {
      return await this.#connecting
    } finally {
      this.#connecting = null
    }
  }

  /**
   * Connects, walking addresses from the current index.
   *
   * @throws ProviderUnavailableError if no usable addresses remain.
   */
  async #connectFromCurrentIndex(): Promise<IProvider> {
    let lastError: unknown = null

    while (this.#index < this.#endpoints.length) {
      const endpoint = this.#endpoints[this.#index] as IRpcEndpoint

      try {
        const provider = await this.#connect(endpoint, this.chainId)

        this.#current = provider

        return provider
      } catch (error) {
        lastError = error
        this.#rotate(endpoint, error instanceof Error ? error.message : String(error))
      }
    }

    throw new ProviderUnavailableError(this.chainId, { cause: lastError })
  }

  /** Drops the current address and moves to the next. */
  #rotate(failed: IRpcEndpoint, reason: string): void {
    this.#current?.destroy()
    this.#current = null
    this.#index += 1

    const next = this.#endpoints[this.#index] ?? null

    /* The log gets the source id, NOT the URL. An Alchemy URL contains
       an API key, and a user's own node URL is an account key or a
       machine location. The log ends up in error reports and the
       browser console. */
    this.#logger.warn('The node was excluded from the rotation', {
      providerId: failed.providerId,
      hasReplacement: next !== null,
      reason,
    })

    this.#onSwitch?.(failed, next, reason)
  }
}
