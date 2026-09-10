import { areAddressesEqual } from '@/core/address'
import {
  InsufficientFundsError,
  InsufficientTokenBalanceError,
  NetworkNotFoundError,
  NftNotOwnedError,
  TransactionNotFoundError,
  TransactionNotReplaceableError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import { encodeRevokeAllowance, encodeRevokeApprovalForAll } from '@/core/approval'
import type { INetworkConfig, INetworkService } from '@/core/network'
import {
  ERC1155_BALANCE_OF_SELECTOR,
  OWNER_OF_SELECTOR,
  decodeAddress,
  encodeCallWithAddressAndUint,
  encodeCallWithUint,
  encodeSafeTransfer1155,
  encodeSafeTransfer721,
} from '@/core/nft'
import {
  BALANCE_OF_SELECTOR,
  TOKEN_STANDARD,
  decodeUint,
  encodeCallWithAddress,
  encodeTransfer,
} from '@/core/token'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import {
  toWei,
  type Address,
  type ChainId,
  type HexString,
  type TxHash,
  type Unsubscribe,
  type Wei,
} from '@/core/types'

import type { ITransactionRepository, ITransactionService } from './contracts'
import {
  FEE_PRIORITY,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type FeePriority,
  type IFeeEstimate,
  type ISignableTransaction,
  type ISignedTransaction,
  type INftTransferRequest,
  type IRevokeApprovalRequest,
  type ITokenTransferRequest,
  type ITransactionRecord,
  type ITransactionRequest,
  type TransactionEventMap,
  type TransactionStatus,
} from './types'

const SERVICE_NAME = 'TransactionService'

/**
 * Priority-fee markups by urgency level.
 *
 * Values are relative to what the node proposed: the node already
 * accounts for current network load, and assigning absolute amounts
 * would ignore it. The "low" level does not go below the proposal —
 * an understated fee becomes a transaction hanging in the mempool
 * for hours.
 */
const PRIORITY_MULTIPLIER: Readonly<Record<Exclude<FeePriority, 'custom'>, bigint>> = {
  [FEE_PRIORITY.Low]: 100n,
  [FEE_PRIORITY.Medium]: 125n,
  [FEE_PRIORITY.High]: 175n,
}

const MULTIPLIER_BASE = 100n

/**
 * Gas-limit headroom above the estimate, in percent.
 *
 * The estimate runs on the current block's state, and the
 * transaction will land in the next: contract state can change,
 * and an exact limit may not suffice. Unused gas is returned;
 * a shortfall reverts with a charge — headroom is cheaper.
 */
const GAS_LIMIT_HEADROOM = 120n

/**
 * How often sent transactions are polled.
 *
 * Close to Ethereum's block time. Polling faster is pointless:
 * state does not change faster than a block, and public-node
 * limits are spent on every call. On networks with faster blocks
 * the lag is seconds and does not affect the user's decisions.
 */
const TRACKING_INTERVAL_MS = 12_000

/**
 * After how many confirmations tracking stops.
 *
 * THIS IS NOT FINALITY, IT IS A BOUND OF REASONABLE WAITING.
 * Complete irreversibility does not exist on EVM networks at all:
 * a reorg is possible at any depth, just with a rapidly falling
 * probability. Three blocks is the compromise: reorgs of that
 * depth after Ethereum moved to Proof-of-Stake are exceptionally
 * rare, and polling the node forever for every old transaction
 * would cost limits and reveal wallet activity.
 */
const CONFIRMATIONS_TO_STOP_TRACKING = 3

/**
 * Fee markup on a replacement transaction, in percent.
 *
 * The node accepts a replacement only if the new fee is NOTICEABLY
 * higher than the old: on geth the threshold is `txpool.pricebump`
 * and defaults to ten percent. Exactly ten must not be used —
 * integer rounding down yields one less than the threshold, and
 * the node answers "replacement underpriced". Fifteen also passes
 * on nodes with a raised threshold.
 *
 * THE MARKUP APPLIES TO BOTH PARTS of an EIP-1559 fee. Raising
 * only the max fee and leaving the priority fee would not get
 * a replacement: the node compares both.
 */
const REPLACEMENT_BUMP_PERCENT = 115n

const SIMPLE_TRANSFER_GAS = 21_000n

export interface ITransactionServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly repository: ITransactionRepository
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Preparing, sending, and storing transactions.
 *
 * THE SERVICE DOES NOT SIGN. Signing is done by the key owner —
 * `AccountManager`. The split is required: otherwise the
 * transaction layer would gain access to secrets, and the
 * perimeter of their storage would expand across the domain.
 *
 * `prepare` RETURNS EXACTLY WHAT WILL BE SIGNED. The confirmation
 * screen shows this object's fields, and the same object goes to
 * the signature. Recalculating values between show and sign is
 * not allowed: a mismatch between what is shown and what is
 * signed is the main class of attacks on a wallet UI.
 */
export class TransactionService implements ITransactionService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #repository: ITransactionRepository
  readonly #clock: IClock
  readonly #logger: ILogger

  /* Cancel of the periodic poll. `null` until tracking is started. */
  #cancelTracking: Unsubscribe | null = null

  /* A poll pass is in progress. Guards against overlapping passes
     when the node answers slower than the next period arrives. */
  #isTracking = false

  readonly #events = new EventBus<TransactionEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Transaction event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  constructor(dependencies: ITransactionServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#repository = dependencies.repository
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  /**
   * Turns a user intent into a transaction ready to sign.
   *
   * ORDER OF STEPS MATTERS.
   *
   * 1. The nonce is taken with the mempool in mind. A value that
   *    ignores pending transactions would make the new one replace
   *    the previous instead of queuing — the earlier transfer would
   *    vanish silently.
   *
   * 2. The gas limit is estimated by asking the node. A failed
   *    estimate means the call will revert: gas is spent, the
   *    operation does not run. Assigning a limit arbitrarily in
   *    that case is not allowed.
   *
   * 3. Sufficiency of funds is checked here, not in the UI. A
   *    check in the form is forgotten when a second send path
   *    appears; here it cannot be bypassed.
   *
   * @throws GasEstimationFailedError, InsufficientFundsError,
   *         ProviderUnavailableError, NetworkNotFoundError
   */
  async prepare(request: ITransactionRequest): Promise<ISignableTransaction> {
    const network = this.#requireNetwork(request)
    const provider = await this.#resolver.get(network)

    const nonce = request.nonce ?? (await provider.getNonce(request.from))
    const gasLimit = request.gasLimit ?? (await this.#estimateGasLimit(provider, request))
    const feeData = await provider.getFeeData()

    /* The type is decided by network support AND by the node
       having the data: a network may claim EIP-1559 while the
       node does not report a base fee — then a type-2 transaction
       would be rejected. */
    const useEip1559 = network.supportsEip1559 && feeData.maxFeePerGas !== null

    const transaction: ISignableTransaction = {
      type: useEip1559 ? TRANSACTION_TYPE.Eip1559 : TRANSACTION_TYPE.Legacy,
      chainId: network.chainId,
      from: request.from,
      to: request.to,
      value: request.value,
      data: request.data ?? ('0x' as HexString),
      nonce,
      gasLimit,
      maxFeePerGas: useEip1559 ? feeData.maxFeePerGas : null,
      maxPriorityFeePerGas: useEip1559 ? feeData.maxPriorityFeePerGas : null,
      gasPrice: useEip1559 ? null : (feeData.gasPrice ?? 0n),
    }

    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /**
   * Turns an intent to send a token into a transaction to sign.
   *
   * WHAT ACTUALLY HAPPENS. A token transfer is a contract function
   * call. The transaction's `to` points at the token contract, the
   * native-currency amount is zero, and the real recipient and
   * quantity sit in the call data. The UI must show that just as
   * plainly, or the user will compare the contract address with
   * the recipient and find no match.
   *
   * THE TOKEN BALANCE IS CHECKED HERE. Native funds may cover the
   * fee while tokens do not; then the contract reverts the call,
   * gas is spent, and there is no transfer. A node reject on gas
   * estimate would only say "the call will revert", without naming
   * the reason.
   *
   * @throws InsufficientTokenBalanceError if tokens are less than the amount,
   *         GasEstimationFailedError if the call will revert,
   *         InsufficientFundsError if the fee cannot be covered.
   */
  async prepareTokenTransfer(request: ITokenTransferRequest): Promise<ISignableTransaction> {
    const network = this.#requireNetwork(request)
    const provider = await this.#resolver.get(network)

    await this.#assertSufficientTokens(provider, request)

    return await this.prepare({
      ...(request.chainId === undefined ? {} : { chainId: request.chainId }),
      ...(request.feePriority === undefined ? {} : { feePriority: request.feePriority }),
      from: request.from,
      to: request.token,
      value: toWei(0n),
      data: encodeTransfer(request.to, request.amount),
    })
  }

  /**
   * Turns an intent to transfer an item into a transaction to sign.
   *
   * THE CALL DEPENDS ON THE STANDARD. ERC-721 transfers one
   * indivisible item, ERC-1155 a given number of copies; the
   * functions share a name but take different arguments, and
   * mixing them up calls one that does not exist.
   *
   * THE SAFE TRANSFER VARIANT IS USED. Plain `transferFrom` will
   * send the item to a contract that cannot accept it — from
   * there it never comes back.
   *
   * OWNERSHIP IS CHECKED BEFORE SIGNING. The contract would
   * reject such a call itself, but gas would be spent and the
   * reason would stay opaque.
   *
   * @throws NftNotOwnedError if the item does not belong to the sender,
   *         GasEstimationFailedError if the call will revert,
   *         InsufficientFundsError if the fee cannot be covered.
   */
  async prepareNftTransfer(request: INftTransferRequest): Promise<ISignableTransaction> {
    const network = this.#requireNetwork(request)
    const provider = await this.#resolver.get(network)
    const amount = request.amount ?? 1n

    await this.#assertOwnsNft(provider, request, amount)

    const data =
      request.standard === TOKEN_STANDARD.Erc1155
        ? encodeSafeTransfer1155(request.from, request.to, request.tokenId, amount)
        : encodeSafeTransfer721(request.from, request.to, request.tokenId)

    return await this.prepare({
      ...(request.chainId === undefined ? {} : { chainId: request.chainId }),
      ...(request.feePriority === undefined ? {} : { feePriority: request.feePriority }),
      from: request.from,
      to: request.contract,
      value: toWei(0n),
      data,
    })
  }

  /**
   * Prepares a revoke of a granted allowance.
   *
   * WHAT HAPPENS. ERC-20 tokens have no separate "revoke"
   * function: the allowance is overwritten, and zero means
   * "nothing to spend". For collections the `setApprovalForAll`
   * flag is cleared.
   *
   * THERE IS DELIBERATELY NO CHECK OF THE LIVE VALUE HERE.
   * Revoking an already-revoked allowance is harmless — it only
   * costs gas — and an extra node request between showing the
   * list and signing would open a window in which the answer
   * would go stale just the same.
   */
  async prepareRevokeApproval(request: IRevokeApprovalRequest): Promise<ISignableTransaction> {
    const data =
      request.standard === TOKEN_STANDARD.Erc20
        ? encodeRevokeAllowance(request.spender)
        : encodeRevokeApprovalForAll(request.spender)

    return await this.prepare({
      ...(request.chainId === undefined ? {} : { chainId: request.chainId }),
      ...(request.feePriority === undefined ? {} : { feePriority: request.feePriority }),
      from: request.from,
      to: request.contract,
      value: toWei(0n),
      data,
    })
  }

  /**
   * Checks that the item belongs to the sender.
   *
   * An unreachable contract means "could not check" and passes
   * through: rejecting on a missing value would stop the owner
   * spending their own property because the node was silent.
   * Gas estimation will catch that case.
   */
  async #assertOwnsNft(
    provider: IProvider,
    request: INftTransferRequest,
    amount: bigint,
  ): Promise<void> {
    try {
      if (request.standard === TOKEN_STANDARD.Erc1155) {
        const balance = decodeUint(
          await provider.call({
            to: request.contract,
            data: encodeCallWithAddressAndUint(
              ERC1155_BALANCE_OF_SELECTOR,
              request.from,
              request.tokenId,
            ),
          }),
        )

        if (balance < amount) {
          throw new NftNotOwnedError(
            `you own ${balance.toString()}, while ${amount.toString()} is being sent`,
          )
        }

        return
      }

      const holder = decodeAddress(
        await provider.call({
          to: request.contract,
          data: encodeCallWithUint(OWNER_OF_SELECTOR, request.tokenId),
        }),
      )

      if (!areAddressesEqual(holder, request.from)) {
        throw new NftNotOwnedError('it belongs to a different address')
      }
    } catch (error) {
      if (error instanceof NftNotOwnedError) {
        throw error
      }

      this.#logger.warn('Item ownership could not be verified', {
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Checks that there are enough tokens for the transfer.
   *
   * No answer from the contract is "could not check", not "zero
   * balance": rejecting on a missing value would stop a send
   * because the node is down. That case passes through, where
   * gas estimation will catch it.
   */
  async #assertSufficientTokens(
    provider: IProvider,
    request: ITokenTransferRequest,
  ): Promise<void> {
    let balance: bigint

    try {
      balance = decodeUint(
        await provider.call({
          to: request.token,
          data: encodeCallWithAddress(BALANCE_OF_SELECTOR, request.from),
        }),
      )
    } catch (error) {
      this.#logger.warn('The token balance could not be read', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return
    }

    if (balance < request.amount) {
      throw new InsufficientTokenBalanceError(request.amount, balance)
    }
  }

  /**
   * Fee options to show the user.
   *
   * Three levels are returned at once: the choice between speed
   * and cost is the user's, not the wallet's.
   *
   * EXPECTED TIME IS NOT REPORTED. It depends on network load at
   * inclusion time, which cannot be predicted. Showing an invented
   * number would make a promise the wallet does not stand behind.
   */
  estimateFees(transaction: ISignableTransaction): Promise<readonly IFeeEstimate[]> {
    const levels: Exclude<FeePriority, 'custom'>[] = [
      FEE_PRIORITY.Low,
      FEE_PRIORITY.Medium,
      FEE_PRIORITY.High,
    ]

    return Promise.resolve(levels.map((priority) => this.#scaleFee(transaction, priority)))
  }

  /** Applies the chosen fee level to the transaction. */
  applyFee(transaction: ISignableTransaction, fee: IFeeEstimate): ISignableTransaction {
    return {
      ...transaction,
      gasLimit: fee.gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      gasPrice: fee.gasPrice,
    }
  }

  /**
   * Publishes a signed transaction and writes it to history.
   *
   * THE RECORD IS SAVED AFTER A SUCCESSFUL PUBLISH. Saving before
   * that would leave in history a transaction that is not on the
   * network, and the user would wait for a confirmation of something
   * that was never sent.
   *
   * A TRANSPORT FAILURE IS NOT TURNED INTO A RETRY. The fate of
   * the send is then unknown: the node may have accepted the
   * transaction and not answered in time. The user decides after
   * seeing the reason, not the wallet in silence.
   */
  async send(signed: ISignedTransaction): Promise<TxHash> {
    const network = this.#requireNetwork({ chainId: signed.transaction.chainId })
    const provider = await this.#resolver.get(network)
    const hash = await provider.sendRawTransaction(signed.raw)

    const record: ITransactionRecord = {
      hash,
      chainId: signed.transaction.chainId,
      from: signed.transaction.from,
      to: signed.transaction.to,
      value: signed.transaction.value,
      nonce: signed.transaction.nonce,
      status: TRANSACTION_STATUS.Pending,
      type: signed.transaction.type,
      submittedAt: this.#clock.now(),
      confirmedAt: null,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      replacedBy: null,
      confirmations: 0,
      /* Parameters are stored for a speed-up: it repeats THE SAME
         operation at the same nonce. Without call data and a gas
         limit a different transaction would go out under the same
         number instead of a speed-up. */
      data: signed.transaction.data,
      gasLimit: signed.transaction.gasLimit,
      maxFeePerGas: signed.transaction.maxFeePerGas,
      maxPriorityFeePerGas: signed.transaction.maxPriorityFeePerGas,
      gasPrice: signed.transaction.gasPrice,
    }

    await this.#repository.save(record)

    this.#logger.info('Transaction published', { chainId: signed.transaction.chainId })
    this.#events.emit('transaction:submitted', { record })

    return hash
  }

  async getHistory(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    return await this.#repository.findByAddress(address, chainId)
  }

  async getByHash(hash: TxHash): Promise<ITransactionRecord | null> {
    return await this.#repository.findByHash(hash)
  }

  /**
   * Updates the state of a sent transaction from a receipt.
   *
   * Called by the UI after a send. Full tracking that accounts
   * for a chain reorg is a later stage.
   */
  async refreshStatus(hash: TxHash): Promise<TransactionStatus | null> {
    const record = await this.#repository.findByHash(hash)

    if (record === null) {
      return null
    }

    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)
    const receipt = await provider.getTransactionReceipt(hash)

    if (receipt === null) {
      return TRANSACTION_STATUS.Pending
    }

    /* A transaction included in a block may have reverted: gas was
       spent, the operation did not run. It must not be shown as a success. */
    const status =
      receipt.status === 'success' ? TRANSACTION_STATUS.Confirmed : TRANSACTION_STATUS.Reverted

    await this.#repository.save({
      ...record,
      status,
      confirmedAt: this.#clock.now(),
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
    })

    this.#events.emit('transaction:statusChanged', { hash, status })

    return status
  }

  /**
   * Prepares a speed-up of a stuck transaction.
   *
   * WHAT A SPEED-UP IS. A resend of THE SAME operation at the same
   * nonce with a higher fee. The node replaces the previous
   * transaction with the new one because two with one number cannot
   * exist.
   *
   * THE ORIGINAL OPERATION IS REPEATED: recipient, amount, call
   * data, and gas limit come from the stored record. Recalculating
   * them would send a different transaction under the same number —
   * the user would wait for a speed-up of their transfer and get
   * who-knows-what.
   *
   * @throws TransactionNotReplaceableError if the transaction is
   *         already in a block, replaced, or its parameters were
   *         not stored.
   */
  async prepareSpeedUp(hash: TxHash): Promise<ISignableTransaction> {
    const record = await this.#requireReplaceable(hash)

    if (record.data === null || record.gasLimit === null) {
      /* The record was made by a version that did not store
         parameters. There is nowhere to restore them, and a guess
         would send a different operation under the same number. */
      throw new TransactionNotReplaceableError(
        'the parameters of the original transaction were not stored; cancelling is still possible',
      )
    }

    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)

    const transaction = await this.#buildReplacement(provider, network, record, {
      to: record.to,
      value: record.value,
      data: record.data,
      gasLimit: record.gasLimit,
    })

    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /**
   * Prepares a cancel of a stuck transaction.
   *
   * A SENT TRANSACTION CANNOT BE CANCELLED. Its number can only be
   * taken by another, more expensive one: a zero-amount transfer
   * to self. If nodes accept that first, the original will not run.
   *
   * THERE IS NO GUARANTEE, AND THAT MUST BE SAID PLAINLY. The
   * original may land in a block before the cancel; then the cancel
   * is surplus and simply will not be accepted — its number is
   * already spent. The fee is not charged in that case: a
   * transaction that was not included costs nothing.
   *
   * THE ORIGINAL'S PARAMETERS ARE NOT NEEDED HERE, so cancel is
   * available even for records made before replacement existed.
   *
   * @throws TransactionNotReplaceableError if the transaction is
   *         already in a block or replaced.
   */
  async prepareCancel(hash: TxHash): Promise<ISignableTransaction> {
    const record = await this.#requireReplaceable(hash)
    const network = this.#requireNetwork({ chainId: record.chainId })
    const provider = await this.#resolver.get(network)

    const transaction = await this.#buildReplacement(provider, network, record, {
      /* A transfer to self: funds go nowhere, and the number is taken. */
      to: record.from,
      value: toWei(0n),
      data: '0x' as HexString,
      /* Cost of a simple transfer. Nothing to estimate: there is no operation. */
      gasLimit: SIMPLE_TRANSFER_GAS,
    })

    /* A cancel transfers nothing but needs a fee, and funds are
       held by the original. The node would reject it itself, but
       a lone "underpriced" phrase would not tell the owner the
       issue is the balance. */
    await this.#assertSufficientFunds(provider, transaction)

    return transaction
  }

  /** Checks that the transaction can still be replaced. */
  async #requireReplaceable(hash: TxHash): Promise<ITransactionRecord> {
    const record = await this.#repository.findByHash(hash)

    if (record === null) {
      throw new TransactionNotFoundError(hash)
    }

    if (record.status === TRANSACTION_STATUS.Confirmed) {
      throw new TransactionNotReplaceableError('it is already included in a block')
    }

    if (record.status === TRANSACTION_STATUS.Reverted) {
      throw new TransactionNotReplaceableError(
        'it is already included in a block, although it reverted',
      )
    }

    if (record.status === TRANSACTION_STATUS.Replaced) {
      throw new TransactionNotReplaceableError(
        'its slot has already been taken by another transaction',
      )
    }

    return record
  }

  /**
   * Builds a replacement transaction with a raised fee.
   *
   * The fee is the greater of two: the previous with a markup,
   * and the node's current proposal. The first is needed so the
   * node accepts the replacement; the second so the new
   * transaction does not stick the same way if the network got
   * more expensive.
   */
  async #buildReplacement(
    provider: IProvider,
    network: INetworkConfig,
    record: ITransactionRecord,
    payload: {
      readonly to: Address | null
      readonly value: Wei
      readonly data: HexString
      readonly gasLimit: bigint
    },
  ): Promise<ISignableTransaction> {
    const feeData = await provider.getFeeData()
    const useEip1559 = network.supportsEip1559 && feeData.maxFeePerGas !== null

    return {
      type: useEip1559 ? TRANSACTION_TYPE.Eip1559 : TRANSACTION_TYPE.Legacy,
      chainId: record.chainId,
      from: record.from,
      to: payload.to,
      value: payload.value,
      data: payload.data,
      /* THE SAME NUMBER — that is the whole point of a replacement.
         Taking the next free one, the wallet would send a second
         transaction in addition to the stuck one, not instead of it. */
      nonce: record.nonce,
      gasLimit: payload.gasLimit,
      maxFeePerGas: useEip1559 ? bumped(record.maxFeePerGas, feeData.maxFeePerGas) : null,
      maxPriorityFeePerGas: useEip1559
        ? bumped(record.maxPriorityFeePerGas, feeData.maxPriorityFeePerGas)
        : null,
      gasPrice: useEip1559 ? null : bumped(record.gasPrice, feeData.gasPrice),
    }
  }

  /**
   * Starts watching sent transactions.
   *
   * WHAT IS TRACKED. Every pending record is polled by receipt.
   * Four outcomes are possible, and all four mean something
   * different to the user:
   *
   * - no receipt, nonce not spent — the transaction is still in the mempool;
   * - no receipt, nonce already spent — another transaction of the
   *   same sender took its place. Showing it as pending would
   *   promise a transfer that will not happen;
   * - a receipt, execution succeeded — the operation completed;
   * - a receipt, execution reverted — gas was spent, the operation
   *   did not run. That is NOT a success and must not be shown as one.
   *
   * A CHAIN REORG IS ACCOUNTED FOR. A receipt can vanish after it
   * was received: the block that held the transaction was evicted
   * by another. Such a record returns to pending, and does not
   * stay confirmed — otherwise the wallet would claim as done
   * something that is not on the chain.
   *
   * ALREADY-CONFIRMED RECORDS ARE POLLED TOO, while their depth is
   * below the threshold: otherwise reorg handling would be dead
   * code — a confirmed record would simply not enter the sample.
   *
   * EVERY NETWORK IS POLLED, not only the active one: a
   * transaction does not cease to exist because the user switched
   * networks. Usually there are zero or one such networks, and the
   * poll cost is proportional to the actual work.
   *
   * A REPEAT CALL IS HARMLESS: a second timer is not created.
   */
  startTracking(): void {
    if (this.#cancelTracking !== null) {
      return
    }

    this.#cancelTracking = this.#clock.setInterval(() => {
      void this.#trackPending()
    }, TRACKING_INTERVAL_MS)

    /* The first pass runs at once: the app may have been closed
       for an hour, and waiting another poll period to learn the
       transfer's fate is unnecessary. */
    void this.#trackPending()
  }

  stopTracking(): void {
    this.#cancelTracking?.()
    this.#cancelTracking = null
  }

  async #trackPending(): Promise<void> {
    if (this.#isTracking) {
      /* The previous pass has not finished: the node answers
         slower than the poll. Overlapping passes would double
         the load and could write a stale result over a fresh one. */
      return
    }

    this.#isTracking = true

    try {
      const pending = await this.#repository.findUnsettled(CONFIRMATIONS_TO_STOP_TRACKING)

      for (const record of pending) {
        try {
          await this.#refreshTracked(record)
        } catch (error) {
          /* One network being down must not stop watching the others. */
          this.#logger.warn('The transaction status could not be read', {
            chainId: record.chainId,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      this.#isTracking = false
    }
  }

  async #refreshTracked(record: ITransactionRecord): Promise<void> {
    const network = this.#networks.getByChainId(record.chainId)

    if (network === null) {
      /* The network was removed from the list. There is nothing
         to judge the transaction by, and silently calling it lost
         is not allowed. */
      return
    }

    const provider = await this.#resolver.get(network)
    const receipt = await provider.getTransactionReceipt(record.hash)

    if (receipt === null) {
      await this.#handleMissingReceipt(record, provider)

      return
    }

    const latestBlock = await provider.getBlockNumber()
    const confirmations = Math.max(1, Number(latestBlock - receipt.blockNumber) + 1)

    const status =
      receipt.status === 'success' ? TRANSACTION_STATUS.Confirmed : TRANSACTION_STATUS.Reverted

    await this.#repository.save({
      ...record,
      status,
      confirmedAt: record.confirmedAt ?? this.#clock.now(),
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      confirmations,
    })

    if (record.status !== status) {
      this.#events.emit('transaction:statusChanged', { hash: record.hash, status })
    }

    if (confirmations >= CONFIRMATIONS_TO_STOP_TRACKING) {
      /* Depth is enough: the record will not enter the next sample,
         and polling it will stop on its own. */
      this.#logger.info('Transaction settled', {
        chainId: record.chainId,
        confirmations,
      })
    }
  }

  /**
   * Handles the case where there is no receipt.
   *
   * Distinguishing "still in flight" from "the slot was taken by
   * another transaction" is done by the count of transactions sent
   * from the address: if it exceeded our nonce, that nonce is
   * already spent, and there is no receipt — spent by someone else.
   *
   * THE REPLACEMENT TRANSACTION HASH IS UNKNOWN, and inventing it
   * is not allowed: finding it takes a walk of blocks, which is
   * an indexer's job. The field stays empty — the user is told
   * the fact itself.
   */
  async #handleMissingReceipt(record: ITransactionRecord, provider: IProvider): Promise<void> {
    const confirmedCount = await provider.getTransactionCount(record.from, 'latest')

    if (confirmedCount > record.nonce) {
      await this.#applyRollback(record, TRANSACTION_STATUS.Replaced)

      return
    }

    if (record.confirmations === 0) {
      /* Ordinary wait: nothing changed. */
      return
    }

    /* The record was confirmed and the receipt is gone: the block
       was evicted by a reorg. Leaving it confirmed would claim as
       done something that is not on the chain. */
    this.#logger.warn('Transaction returned to pending: its block was reorganised away', {
      chainId: record.chainId,
    })

    await this.#applyRollback(record, TRANSACTION_STATUS.Pending)
  }

  async #applyRollback(record: ITransactionRecord, status: TransactionStatus): Promise<void> {
    await this.#repository.save({
      ...record,
      status,
      confirmations: 0,
      blockNumber: null,
      confirmedAt: null,
    })

    this.#events.emit('transaction:statusChanged', { hash: record.hash, status })
  }

  on<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof TransactionEventMap>(
    event: TName,
    listener: EventListener<TransactionEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Estimates the gas limit with headroom.
   *
   * A failed estimate is not caught: it means the call will revert,
   * and the transaction must not be sent. Substituting an arbitrary
   * limit would guarantee burning gas for nothing.
   */
  async #estimateGasLimit(provider: IProvider, request: ITransactionRequest): Promise<bigint> {
    /* ABSENCE OF A RECIPIENT IS PASSED TO THE NODE AS-IS. That is
       how the node learns a contract deploy is being estimated.
       The sender address used to be substituted here, and the node
       estimated a transfer to self — an amount that is not enough
       for a deploy: the transaction would revert with gas spent. */
    const estimate = await provider.estimateGas({
      to: request.to,
      from: request.from,
      data: request.data ?? ('0x' as HexString),
      value: request.value,
    })

    return (estimate * GAS_LIMIT_HEADROOM) / MULTIPLIER_BASE
  }

  /**
   * Checks that funds cover the transfer together with the fee.
   *
   * Counted by the UPPER bound of the fee, not the expected one:
   * less will be charged, but the node checks the upper bound and
   * will reject the transaction if the balance does not cover it.
   */
  async #assertSufficientFunds(
    provider: IProvider,
    transaction: ISignableTransaction,
  ): Promise<void> {
    const balance = await provider.getBalance(transaction.from)
    const feePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n
    const required = transaction.value + transaction.gasLimit * feePerGas

    if (required > balance) {
      throw new InsufficientFundsError(required, balance)
    }
  }

  #scaleFee(
    transaction: ISignableTransaction,
    priority: Exclude<FeePriority, 'custom'>,
  ): IFeeEstimate {
    const multiplier = PRIORITY_MULTIPLIER[priority]

    if (transaction.type === TRANSACTION_TYPE.Eip1559) {
      const tip = ((transaction.maxPriorityFeePerGas ?? 0n) * multiplier) / MULTIPLIER_BASE
      const base = (transaction.maxFeePerGas ?? 0n) - (transaction.maxPriorityFeePerGas ?? 0n)
      const maxFeePerGas = base + tip

      return {
        priority,
        maxFeePerGas,
        maxPriorityFeePerGas: tip,
        gasPrice: null,
        gasLimit: transaction.gasLimit,
        maxCost: (transaction.gasLimit * maxFeePerGas) as Wei,
        estimatedSeconds: null,
      }
    }

    const gasPrice = ((transaction.gasPrice ?? 0n) * multiplier) / MULTIPLIER_BASE

    return {
      priority,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      gasPrice,
      gasLimit: transaction.gasLimit,
      maxCost: (transaction.gasLimit * gasPrice) as Wei,
      estimatedSeconds: null,
    }
  }

  #requireNetwork(request: { chainId?: ChainId }) {
    const chainId = request.chainId ?? this.#networks.getActive().chainId
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return network
  }
}

/**
 * Fee of a replacement transaction.
 *
 * The greater of two: the previous value with a markup, and the
 * node's current proposal. The previous is needed so the node
 * accepts the replacement; the current so the new transaction
 * does not stick the same way if the network got more expensive.
 *
 * Absence of a previous value is not a reason to refuse the
 * replacement: the node's proposal is taken. Zero would mean a
 * transaction nobody will accept.
 */
function bumped(previous: bigint | null, current: bigint | null): bigint {
  const raised = previous === null ? 0n : (previous * REPLACEMENT_BUMP_PERCENT) / MULTIPLIER_BASE

  return raised > (current ?? 0n) ? raised : (current ?? 0n)
}
