import type { IEventSource } from '@/core/events'
import type { INetworkConfig } from '@/core/network'
import type { Address, BlockTag, ChainId, HexString, TxHash, Wei } from '@/core/types'

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
 * Transport to a blockchain node.
 *
 * Distinct from `INetworkConfig`: config is data (chainId, name, RPC
 * list), a provider is a live connection to a specific node, with
 * state, and it must be destroyed.
 *
 * One network has one active provider, but it is rebuilt when the
 * node is unreachable and when switching to a backup. So the provider
 * is not stored in config and is not serialized.
 *
 * The abstraction deliberately does not mention ethers: replacing the
 * library must not touch the domain.
 *
 * SECURITY REQUIREMENT for an implementation: on connect, request
 * `eth_chainId` and compare it with the expected value. A mismatch
 * is `ChainIdMismatchError` and an immediate disconnect. Continuing
 * with a node that serves another network leads to a signature valid
 * for replay.
 */
export interface IProvider extends IEventSource<ProviderEventMap> {
  /** Network the connection belongs to. */
  readonly chainId: ChainId

  /** Node URL the connection is established with. */
  readonly rpcUrl: string

  /** Whether the transport is active. `false` after `destroy`. */
  readonly isActive: boolean

  /**
   * Arbitrary JSON-RPC call.
   *
   * Escape hatch for methods not covered by the typed wrappers below.
   * The result is untyped — the caller must validate it.
   */
  request<TResult>(request: IRpcRequest): Promise<TResult>

  /**
   * Network id as reported by the node.
   *
   * A separate method from the `chainId` property: the property holds
   * the EXPECTED value from config, the method asks the node again.
   * A mismatch means the node switched networks after connect —
   * work with it must stop.
   */
  getChainId(): Promise<ChainId>

  /** Latest block number. */
  getBlockNumber(): Promise<bigint>

  /** Native-currency balance. */
  getBalance(address: Address, blockTag?: BlockTag): Promise<Wei>

  /**
   * Number of transactions sent from the address.
   *
   * Low-level call with an explicit block. To form a new transaction
   * use {@link IProvider.getNonce}.
   */
  getTransactionCount(address: Address, blockTag?: BlockTag): Promise<number>

  /**
   * Next nonce for a NEW transaction.
   *
   * Always accounts for mempool transactions. The separate method
   * exists for exactly that: `getTransactionCount` with the default
   * tag returns a value that ignores pending transactions, and a new
   * transaction would replace the pending one instead of queuing.
   * The bug is silent and is only noticed when a transfer disappears.
   */
  getNonce(address: Address): Promise<number>

  /** Contract call without changing state. */
  call(request: ICallRequest, blockTag?: BlockTag): Promise<HexString>

  /**
   * Bytecode at an address.
   *
   * Empty (`0x`) means an ordinary address, non-empty means a contract.
   * The distinction matters for a transfer: native currency sent to a
   * contract that does not accept it is lost forever — only the
   * contract's own code can return it, and that code may not exist.
   */
  getCode(address: Address, blockTag?: BlockTag): Promise<HexString>

  /**
   * Gas-limit estimate.
   *
   * @throws GasEstimationFailedError if the call would revert.
   *         Assigning an arbitrary limit in that situation is not
   *         allowed: gas would be spent and the operation would not run.
   */
  estimateGas(request: IGasEstimateRequest): Promise<bigint>

  /** Current gas-price parameters. */
  getFeeData(): Promise<IFeeData>

  /**
   * Publishes a signed transaction.
   *
   * Accepts already-signed bytes. The provider has no access to keys
   * and does not take part in signing — that is the boundary between
   * transport and secret storage.
   */
  sendRawTransaction(signedTransaction: HexString): Promise<TxHash>

  /** Transaction receipt. `null` if it is not yet included in a block. */
  getTransactionReceipt(hash: TxHash): Promise<ITransactionReceipt | null>

  /** Log query by filter. */
  getLogs(filter: ILogFilter): Promise<readonly ILogEntry[]>

  /**
   * Closes the connection and releases resources.
   *
   * Required on network change and when the core is destroyed:
   * unclosed new-block subscriptions keep polling the node and hold
   * references to handlers.
   */
  destroy(): void
}

/**
 * Creating providers.
 *
 * Injected into services instead of concrete providers. That allows:
 * - rebuilding transport on node failure without touching consumers;
 * - substituting a fake transport in tests;
 * - implementing RPC-address switching in one place.
 */
export interface IProviderFactory {
  /**
   * Creates a provider for a network.
   *
   * The implementation walks `rpcUrls` in priority order and returns
   * a connection to the first node that answered and passed chainId
   * verification.
   *
   * @throws ProviderUnavailableError if no node answers.
   * @throws ChainIdMismatchError if the answering node serves another
   *         network and no backups remain.
   */
  create(network: INetworkConfig): Promise<IProvider>
}

/**
 * Handing a ready connection to consumers.
 *
 * Distinct from `IProviderFactory`: the factory ALWAYS creates a new
 * connection, the resolver returns an existing one and creates only
 * when none exists.
 *
 * The split exists so application services (balances, transactions)
 * depend on a narrow "give me a connection" contract, not on a
 * specific cache. A service that received a factory would open a new
 * connection on every balance request.
 */
export interface IProviderResolver {
  /**
   * Connection to a network.
   *
   * @throws ProviderUnavailableError if no node is available.
   */
  get(network: INetworkConfig): Promise<IProvider>
}
