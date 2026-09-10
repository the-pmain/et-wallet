import { FetchRequest, JsonRpcProvider, Network, type JsonRpcApiProvider } from 'ethers'

import { toAddress } from '@/core/address'
import { EventBus, type EventListener } from '@/core/events'
import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import {
  parseChainIdFromHex,
  toBlockHash,
  toChainId,
  toTxHash,
  type Address,
  type BlockTag,
  type ChainId,
  type HexString,
  type TxHash,
  type Unsubscribe,
  type Wei,
} from '@/core/types'

import type { IProvider } from './contracts'
import { mapProviderError } from './error-mapping'
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

/**
 * Maximum time to wait for a node response.
 *
 * Without a limit a hung node would hang the wallet: the user would
 * see an endless load instead of a prompt to change network. Thirty
 * seconds covers a slow mobile network with margin and still does not
 * look like a hang.
 */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * How often new blocks are polled.
 *
 * Applied only when there are subscribers: ethers does not poll the
 * node while nobody is listening. Four seconds roughly matches the
 * Ethereum block time and does not waste public-node quotas.
 */
const DEFAULT_POLLING_INTERVAL_MS = 4_000

/** Connection settings. */
export interface IRpcClientOptions {
  readonly timeoutMs?: number
  readonly pollingIntervalMs?: number
}

/**
 * Transport to a node on top of ethers v6.
 *
 * The ONLY place in the app that knows ethers exists. The domain
 * depends on `IProvider`, so replacing the library touches only this
 * file and the error mapping.
 *
 * WHAT HAPPENS ON CONNECT:
 *
 * 1. `eth_chainId` is requested and compared with the expected value.
 *    A mismatch is a refusal and a disconnect. A node serving another
 *    network would make the wallet sign a transaction valid for replay
 *    on the target network.
 *
 * 2. The network is pinned with `staticNetwork`. Without it ethers
 *    periodically re-requests chainId and SILENTLY follows the node
 *    if it switches networks. For a wallet that is unacceptable:
 *    changing network must be the user's decision.
 */
export class RpcClient implements IProvider {
  readonly chainId: ChainId
  readonly rpcUrl: string

  readonly #provider: JsonRpcApiProvider
  readonly #events = new EventBus<ProviderEventMap>()

  #active = true
  #blockListener: ((blockNumber: number) => void) | null = null

  private constructor(provider: JsonRpcApiProvider, chainId: ChainId, rpcUrl: string) {
    this.#provider = provider
    this.chainId = chainId
    this.rpcUrl = rpcUrl
  }

  /**
   * Establishes an HTTP connection to a node.
   *
   * @throws ProviderUnavailableError if the node does not answer.
   * @throws ChainIdMismatchError if the node serves another network.
   */
  static async connect(
    rpcUrl: string,
    expectedChainId: ChainId,
    options: IRpcClientOptions = {},
  ): Promise<RpcClient> {
    const request = new FetchRequest(rpcUrl)
    request.timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const provider = new JsonRpcProvider(request, Network.from(Number(expectedChainId)), {
      /* Network is pinned: ethers will not re-request chainId and
         will not follow a node that switched networks. */
      staticNetwork: Network.from(Number(expectedChainId)),
      pollingInterval: options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
    })

    return await RpcClient.attach(provider, expectedChainId, rpcUrl)
  }

  /**
   * Wraps a ready ethers provider.
   *
   * Extension point for non-standard transports — WebSocket, IPC, an
   * internal extension provider. chainId is verified the same way as
   * on a normal connect.
   */
  static async attach(
    provider: JsonRpcApiProvider,
    expectedChainId: ChainId,
    rpcUrl: string,
  ): Promise<RpcClient> {
    const client = new RpcClient(provider, expectedChainId, rpcUrl)

    try {
      await client.#verifyChainId()
    } catch (error) {
      client.destroy()
      throw error
    }

    client.#events.emit('provider:connected', { chainId: expectedChainId, rpcUrl })

    return client
  }

  get isActive(): boolean {
    return this.#active
  }

  async request<TResult>(request: IRpcRequest): Promise<TResult> {
    return await this.#call(async () => {
      return (await this.#provider.send(request.method, [...(request.params ?? [])])) as TResult
    })
  }

  async getChainId(): Promise<ChainId> {
    /* The node response is untrusted: parsing goes through a
       validating constructor, not a type cast. */
    return parseChainIdFromHex(await this.request<unknown>({ method: 'eth_chainId' }))
  }

  async getBlockNumber(): Promise<bigint> {
    return await this.#call(async () => BigInt(await this.#provider.getBlockNumber()))
  }

  async getBalance(address: Address, blockTag?: BlockTag): Promise<Wei> {
    return await this.#call(async () => {
      const balance = await this.#provider.getBalance(
        address,
        RpcClient.#toEthersBlockTag(blockTag),
      )

      return balance as Wei
    })
  }

  async getTransactionCount(address: Address, blockTag?: BlockTag): Promise<number> {
    return await this.#call(
      async () =>
        await this.#provider.getTransactionCount(address, RpcClient.#toEthersBlockTag(blockTag)),
    )
  }

  async getNonce(address: Address): Promise<number> {
    /* The `pending` tag is hardcoded on purpose and is not a
       parameter: the default (`latest`) ignores mempool transactions,
       and a new transaction would replace the pending one. The bug is
       silent — the user notices it when a transfer disappears. */
    return await this.getTransactionCount(address, 'pending')
  }

  async call(request: ICallRequest, blockTag?: BlockTag): Promise<HexString> {
    return await this.#call(async () => {
      const tag = RpcClient.#toEthersBlockTag(blockTag)
      const result = await this.#provider.call({
        ...RpcClient.#toEthersTransaction(request),
        ...(tag === undefined ? {} : { blockTag: tag }),
      })

      return result as HexString
    })
  }

  async getCode(address: Address, blockTag?: BlockTag): Promise<HexString> {
    return await this.#call(async () => {
      const tag = RpcClient.#toEthersBlockTag(blockTag)
      const code = await this.#provider.getCode(address, tag)

      return code as HexString
    })
  }

  async estimateGas(request: IGasEstimateRequest): Promise<bigint> {
    return await this.#call(
      async () => await this.#provider.estimateGas(RpcClient.#toEstimateRequest(request)),
    )
  }

  async getFeeData(): Promise<IFeeData> {
    return await this.#call(async () => {
      const data = await this.#provider.getFeeData()

      return {
        baseFeePerGas: RpcClient.#deriveBaseFee(data.maxFeePerGas, data.maxPriorityFeePerGas),
        maxFeePerGas: data.maxFeePerGas,
        maxPriorityFeePerGas: data.maxPriorityFeePerGas,
        gasPrice: data.gasPrice,
      }
    })
  }

  async sendRawTransaction(signedTransaction: HexString): Promise<TxHash> {
    /* Direct JSON-RPC instead of ethers' `broadcastTransaction`.
       That extra call also requests the block number and builds a
       response object with wait-for-confirm helpers — an extra hop
       to the node on every send. The wallet only needs the hash:
       status tracking belongs to the transaction layer on its own
       schedule.

       The hash goes through a validating constructor: the node
       response is untrusted, and a bad value would land in operation
       history and in a block-explorer link. */
    return await this.#call(async () =>
      toTxHash(await this.#provider.send('eth_sendRawTransaction', [signedTransaction])),
    )
  }

  async getTransactionReceipt(hash: TxHash): Promise<ITransactionReceipt | null> {
    return await this.#call(async () => {
      const receipt = await this.#provider.getTransactionReceipt(hash)

      if (receipt === null) {
        return null
      }

      return {
        transactionHash: toTxHash(receipt.hash),
        blockNumber: BigInt(receipt.blockNumber),
        blockHash: toBlockHash(receipt.blockHash),
        from: toAddress(receipt.from),
        to: receipt.to === null ? null : toAddress(receipt.to),
        /* A transaction included in a block may still have reverted.
           Gas was spent, and showing it as successful is not allowed. */
        status: receipt.status === 1 ? 'success' : 'reverted',
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.gasPrice,
        contractAddress:
          receipt.contractAddress === null ? null : toAddress(receipt.contractAddress),
        logs: receipt.logs.map((log) => RpcClient.#toLogEntry(log)),
      }
    })
  }

  async getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]> {
    return await this.#call(async () => {
      const logs = await this.#provider.getLogs({
        ...(filter.address === undefined ? {} : { address: filter.address }),
        ...(filter.topics === undefined ? {} : { topics: [...filter.topics] }),
        ...(filter.fromBlock === undefined ? {} : { fromBlock: Number(filter.fromBlock) }),
        ...(filter.toBlock === undefined ? {} : { toBlock: Number(filter.toBlock) }),
      })

      return logs.map((log) => RpcClient.#toLogEntry(log))
    })
  }

  destroy(): void {
    if (!this.#active) {
      return
    }

    this.#active = false
    this.#stopBlockPolling()
    this.#provider.destroy()
    this.#events.emit('provider:disconnected', {
      chainId: this.chainId,
      reason: 'the connection was closed by the caller',
    })
    this.#events.removeAllListeners()
  }

  on<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    const unsubscribe = this.#events.on(event, listener)

    if (event === 'provider:block') {
      this.#startBlockPolling()
    }

    return () => {
      unsubscribe()
      this.#stopBlockPollingIfIdle()
    }
  }

  once<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): Unsubscribe {
    const unsubscribe = this.#events.once(event, listener)

    if (event === 'provider:block') {
      this.#startBlockPolling()
    }

    return () => {
      unsubscribe()
      this.#stopBlockPollingIfIdle()
    }
  }

  off<TName extends keyof ProviderEventMap>(
    event: TName,
    listener: EventListener<ProviderEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
    this.#stopBlockPollingIfIdle()
  }

  /**
   * Compares the node's chainId with the expected value.
   *
   * The most important transport check. A node serving another
   * network would return foreign balances and a foreign nonce, and a
   * signature built from its data would be valid for replay on the
   * target network.
   */
  async #verifyChainId(): Promise<void> {
    const actual = await this.getChainId()

    if (actual !== this.chainId) {
      throw new ChainIdMismatchError(this.chainId, actual)
    }
  }

  /**
   * Wraps a node call: checks state and maps errors.
   *
   * The activity check is required: talking to a destroyed ethers
   * provider yields an opaque internal error instead of a clear
   * refusal.
   */
  async #call<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    if (!this.#active) {
      throw new ProviderUnavailableError(this.chainId)
    }

    try {
      return await operation()
    } catch (error) {
      throw mapProviderError(error, this.chainId)
    }
  }

  #startBlockPolling(): void {
    if (this.#blockListener !== null || !this.#active) {
      return
    }

    this.#blockListener = (blockNumber: number) => {
      this.#events.emit('provider:block', { blockNumber: BigInt(blockNumber) })
    }

    void this.#provider.on('block', this.#blockListener)
  }

  /** Stops polling when no new-block subscribers remain. */
  #stopBlockPollingIfIdle(): void {
    if (this.#events.listenerCount('provider:block') === 0) {
      this.#stopBlockPolling()
    }
  }

  #stopBlockPolling(): void {
    if (this.#blockListener === null) {
      return
    }

    void this.#provider.off('block', this.#blockListener)
    this.#blockListener = null
  }

  /**
   * Recovers the block base fee.
   *
   * ethers does not return `baseFeePerGas` in fee data, but computes
   * `maxFeePerGas` as `baseFee * 2 + priorityFee`. The inverse gives
   * a base-fee estimate without an extra node request.
   *
   * This is an ESTIMATE, not the exact value from the block header.
   * Fit to show the user; for fee calculation use `maxFeePerGas`
   * directly.
   */
  static #deriveBaseFee(maxFeePerGas: bigint | null, priorityFee: bigint | null): bigint | null {
    if (maxFeePerGas === null || priorityFee === null) {
      return null
    }

    const doubled = maxFeePerGas - priorityFee

    return doubled > 0n ? doubled / 2n : null
  }

  static #toEthersBlockTag(blockTag?: BlockTag): string | number | undefined {
    if (blockTag === undefined) {
      return undefined
    }

    return typeof blockTag === 'bigint' ? Number(blockTag) : blockTag
  }

  /**
   * Prepares a gas-estimate request.
   *
   * The `to` FIELD IS OMITTED ENTIRELY, not filled with something.
   * Its absence is how the node understands contract deployment;
   * substituting the sender address would estimate a simple transfer
   * to self — an amount too small for deployment, and the transaction
   * would revert with gas spent.
   */
  static #toEstimateRequest(request: IGasEstimateRequest): {
    to?: string
    from?: string
    data?: string
    value?: bigint
  } {
    return {
      ...(request.to === null ? {} : { to: request.to }),
      ...(request.from === undefined ? {} : { from: request.from }),
      ...(request.data === undefined ? {} : { data: request.data }),
      ...(request.value === undefined ? {} : { value: request.value }),
    }
  }

  static #toEthersTransaction(request: ICallRequest): {
    to: string
    from?: string
    data?: string
    value?: bigint
  } {
    return {
      to: request.to,
      ...(request.from === undefined ? {} : { from: request.from }),
      ...(request.data === undefined ? {} : { data: request.data }),
      ...(request.value === undefined ? {} : { value: request.value }),
    }
  }

  static #toLogEntry(log: {
    address: string
    topics: readonly string[]
    data: string
    blockNumber: number
    transactionHash: string
    index: number
    removed: boolean
  }): ILogEntry {
    return {
      address: toAddress(log.address),
      topics: log.topics.map((topic) => topic as HexString),
      data: log.data as HexString,
      blockNumber: BigInt(log.blockNumber),
      transactionHash: toTxHash(log.transactionHash),
      logIndex: log.index,
      removed: log.removed,
    }
  }
}

/** Maps an ethers numeric network id to the domain type. */
export function chainIdFromEthers(value: bigint): ChainId {
  return toChainId(value)
}
