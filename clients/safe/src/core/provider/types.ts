import type { Address, BlockHash, ChainId, HexString, TxHash, Wei } from '@/core/types'

/** JSON-RPC request. */
export interface IRpcRequest {
  readonly method: string

  /**
   * Method parameters.
   *
   * Typed as `unknown[]`, not a strict schema, on purpose: the set of
   * JSON-RPC methods is open and differs across nodes. Type safety
   * comes from the typed methods on `IProvider`; raw `request` stays
   * an escape hatch for non-standard calls. Validating the response
   * is the caller's duty.
   */
  readonly params?: readonly unknown[]
}

/** Gas-cost data. */
export interface IFeeData {
  /**
   * Base fee of the current block (EIP-1559).
   * `null` on networks without EIP-1559.
   */
  readonly baseFeePerGas: bigint | null

  /** Maximum total price per gas unit (EIP-1559). */
  readonly maxFeePerGas: bigint | null

  /** Validator tip per gas unit (EIP-1559). */
  readonly maxPriorityFeePerGas: bigint | null

  /** Gas price for legacy-format transactions. */
  readonly gasPrice: bigint | null
}

/** Parameters of a contract call that does not change state (`eth_call`). */
export interface ICallRequest {
  readonly to: Address
  readonly from?: Address
  readonly data?: HexString
  readonly value?: Wei
}

/**
 * Gas-estimate request.
 *
 * DIFFERS FROM `ICallRequest` BY ONE FIELD, AND THE DIFFERENCE MATTERS.
 * Reading a contract without an address is meaningless, but a gas
 * estimate without one is a legal case: no recipient means contract
 * deployment. The node distinguishes those requests by the presence
 * of `to`, and stuffing something in "for compatibility" means
 * estimating the wrong operation.
 */
export interface IGasEstimateRequest {
  /** Recipient. `null` — contract deployment. */
  readonly to: Address | null
  readonly from?: Address
  readonly data?: HexString
  readonly value?: Wei
}

/** Contract event-log entry. */
export interface ILogEntry {
  readonly address: Address
  readonly topics: readonly HexString[]
  readonly data: HexString
  readonly blockNumber: bigint
  readonly transactionHash: TxHash
  readonly logIndex: number
  /** Whether the log was removed by a chain reorganization. */
  readonly removed: boolean
}

/** Receipt of a confirmed transaction. */
export interface ITransactionReceipt {
  readonly transactionHash: TxHash
  readonly blockNumber: bigint
  readonly blockHash: BlockHash
  readonly from: Address
  readonly to: Address | null

  /**
   * Whether execution succeeded.
   *
   * A transaction included in a block may still have reverted. Gas
   * was still spent. Showing such a transaction as successful is not
   * allowed.
   */
  readonly status: 'success' | 'reverted'

  readonly gasUsed: bigint
  readonly effectiveGasPrice: bigint

  /** Deployed contract address, if the transaction created one. */
  readonly contractAddress: Address | null

  readonly logs: readonly ILogEntry[]
}

/** Log-query filter. */
export interface ILogFilter {
  readonly address?: Address
  readonly topics?: readonly (HexString | null)[]
  readonly fromBlock?: bigint
  readonly toBlock?: bigint
}

/** Transport-layer events. */
export interface ProviderEventMap {
  /** A new block appeared. */
  'provider:block': { readonly blockNumber: bigint }
  /** Connection to the node was restored. */
  'provider:connected': { readonly chainId: ChainId; readonly rpcUrl: string }
  /** Connection was lost. */
  'provider:disconnected': { readonly chainId: ChainId; readonly reason: string }
}
