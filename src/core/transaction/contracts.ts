import type { IEventSource } from '@/core/events'
import type { Address, ChainId, TxHash } from '@/core/types'

import type {
  IFeeEstimate,
  ISignableTransaction,
  ISignedTransaction,
  IRevokeApprovalRequest,
  ITokenTransferRequest,
  ITransactionRecord,
  ITransactionRequest,
  TransactionEventMap,
  TransactionStatus,
} from './types'

/**
 * Preparing, sending, and tracking transactions.
 *
 * The service does not sign: signing is done by `IKeyring`, the only
 * owner of secrets. The split is required — otherwise the transaction
 * layer would gain access to keys, and the secret perimeter would
 * expand across the whole domain.
 *
 * All money values are `bigint`. `number` loses precision past
 * 2^53-1, and wei values reach 2^256-1.
 */
export interface ITransactionService extends IEventSource<TransactionEventMap> {
  /**
   * Turns a user intent into a transaction ready to sign.
   *
   * The implementation must:
   * 1. Fetch the nonce with the `pending` tag, or a new transaction
   *    will replace a pending one instead of queuing.
   * 2. Estimate the gas limit. A failed estimate means the call
   *    will revert, and the transaction must not be sent.
   * 3. Fill in the active network's chainId — it is part of the
   *    signed data per EIP-155 and protects the signature from
   *    replay on another network.
   *
   * @throws GasEstimationFailedError, InsufficientFundsError
   */
  prepare(request: ITransactionRequest): Promise<ISignableTransaction>

  /**
   * Prepares an ERC-20 token transfer.
   *
   * The service assembles the call data: recipient and amount live
   * in it, not in the transaction fields, and encoding them in the
   * UI would keep a place whose cost of error is lost funds outside
   * the core.
   *
   * @throws InsufficientTokenBalanceError, GasEstimationFailedError,
   *         InsufficientFundsError
   */
  prepareTokenTransfer(request: ITokenTransferRequest): Promise<ISignableTransaction>

  /**
   * Prepares a revoke of a granted allowance.
   *
   * A revoke is a transaction: the allowance lives in the contract,
   * and removing it takes a call that costs gas and needs a signature.
   */
  prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<ISignableTransaction>

  /**
   * Fee options to show the user.
   *
   * Returns several urgency levels at once: the choice between
   * speed and cost is the user's, not the wallet's.
   */
  estimateFees(transaction: ISignableTransaction): Promise<readonly IFeeEstimate[]>

  /**
   * Publishes a signed transaction and writes it to history.
   *
   * Accepts a signature result, not a request: the service has no
   * access to keys and cannot sign itself.
   */
  send(signed: ISignedTransaction): Promise<TxHash>

  /** Transaction history of an address on a network, newest first. */
  getHistory(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]>

  getByHash(hash: TxHash): Promise<ITransactionRecord | null>

  /**
   * Builds a replacement transaction with a higher fee.
   *
   * Same nonce, higher gas price. Returns a transaction to sign —
   * the user must confirm the new fee.
   *
   * @throws TransactionUnderpricedError if the raise is not enough for the node.
   */
  prepareSpeedUp(hash: TxHash): Promise<ISignableTransaction>

  /**
   * Builds a cancel transaction.
   *
   * A transaction cannot be cancelled on the blockchain. The only
   * way is to evict it from the mempool with a zero-amount transfer
   * to self at the same nonce and a higher fee. Success is not
   * guaranteed: the original may already be in a block. The UI
   * must say so plainly.
   */
  prepareCancel(hash: TxHash): Promise<ISignableTransaction>

  /**
   * Starts tracking statuses of sent transactions.
   *
   * The implementation must account for a chain reorg: a confirmed
   * transaction may return to a pending state.
   */
  startTracking(): void

  stopTracking(): void
}

/** Long-term storage of transaction history. */
export interface ITransactionRepository {
  findByAddress(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]>
  findByHash(hash: TxHash): Promise<ITransactionRecord | null>

  /** Transactions awaiting confirmation. Read when the app starts. */
  findPending(chainId: ChainId): Promise<readonly ITransactionRecord[]>

  /**
   * Transactions that still need watching, from every network.
   *
   * THIS IS NOT THE SAME AS "PENDING". Included here are records
   * already in a block that have fewer than `maxConfirmations`
   * confirmations: their block can be evicted by a reorg, and
   * stopping the watch would leave a confirmation on screen of
   * something that is no longer on the chain.
   *
   * The threshold is set by the caller: how many confirmations
   * are enough is a policy of the transaction layer, not a
   * property of the store.
   *
   * The query spans every network: a transaction does not cease
   * to exist because the user switched networks.
   */
  findUnsettled(maxConfirmations: number): Promise<readonly ITransactionRecord[]>

  save(record: ITransactionRecord): Promise<void>
  updateStatus(hash: TxHash, status: TransactionStatus): Promise<void>

  /** Deletes an address's history. Used when an account is removed. */
  deleteByAddress(address: Address): Promise<void>
}
