import type { TokenStandard } from '@/core/token'
import type { Address, ChainId, HexString, Timestamp, TxHash, Wei } from '@/core/types'

/**
 * Transaction format.
 *
 * `Eip1559` is the main one for modern networks: the fee splits into
 * a base (burned) and a priority (to the validator). `Legacy` is kept
 * for networks without EIP-1559.
 */
export const TRANSACTION_TYPE = {
  Legacy: 'legacy',
  Eip2930: 'eip2930',
  Eip1559: 'eip1559',
} as const

export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE]

export const TRANSACTION_STATUS = {
  /** Signed and sent, not included in a block. */
  Pending: 'pending',
  /** Included in a block and executed successfully. */
  Confirmed: 'confirmed',
  /**
   * Included in a block, but execution reverted.
   * Gas was spent. Must not be shown as successful.
   */
  Reverted: 'reverted',
  /** Evicted from the mempool without inclusion in a block. */
  Dropped: 'dropped',
  /** Replaced by another transaction with the same nonce (speed-up or cancel). */
  Replaced: 'replaced',
} as const

export type TransactionStatus = (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS]

export const FEE_PRIORITY = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Custom: 'custom',
} as const

export type FeePriority = (typeof FEE_PRIORITY)[keyof typeof FEE_PRIORITY]

/**
 * A user's intent to send a transaction.
 *
 * An incomplete set: fee parameters and nonce are computed by the
 * service. The split into "intent" and "transaction ready to sign"
 * exists so computed values cannot be substituted around the checks
 * — only the result of `prepare` goes to the signature.
 */
export interface ITransactionRequest {
  /**
   * Network the transfer is sent on.
   *
   * Not defaulted from the active network on purpose: an intent
   * that does not name a network becomes ambiguous if the user
   * switches networks between filling the form and confirming.
   * An omitted value means the active network at prepare time.
   */
  readonly chainId?: ChainId

  readonly from: Address

  /** Recipient. `null` means a contract deploy. */
  readonly to: Address | null

  readonly value: Wei

  readonly data?: HexString

  readonly nonce?: number

  readonly gasLimit?: bigint

  readonly feePriority?: FeePriority
}

/**
 * Intent to send an ERC-20 token.
 *
 * A SEPARATE TYPE, NOT A FIELD ON `ITransactionRequest`. On a token
 * transfer the recipient and amount do not sit where they do on an
 * ordinary transaction: `to` points at the contract, and the real
 * recipient and quantity are in the call data. Collapsing both
 * intents into one form would let a contract address be confused
 * with a person's.
 *
 * THE CORE ASSEMBLES THE CALL DATA. The UI passes the recipient
 * and amount and does not encode ABI: an error there sends tokens
 * elsewhere with no return.
 */
export interface ITokenTransferRequest {
  readonly chainId?: ChainId

  readonly from: Address

  readonly token: Address

  readonly to: Address

  readonly amount: bigint

  readonly feePriority?: FeePriority
}

/**
 * Intent to transfer a collectible.
 *
 * THE SENDER IS PART OF THE CALL DATA. On `safeTransferFrom` it is
 * an explicit argument, not inferred from the signature: the
 * contract also allows a trusted party to transfer. The wallet
 * passes its own address — anything else would be spending
 * someone else's property.
 */
export interface INftTransferRequest {
  readonly chainId?: ChainId

  readonly from: Address

  readonly contract: Address

  readonly to: Address

  readonly tokenId: bigint

  /**
   * Collection standard.
   *
   * Decides the call: ERC-721 and ERC-1155 have different
   * `safeTransferFrom`. Guessing from the contract is not allowed
   * — an error would call a function that does not exist.
   */
  readonly standard: TokenStandard

  /**
   * How many copies are transferred. ERC-1155 only.
   *
   * For ERC-721 the item is indivisible, and the amount is not
   * part of the call.
   */
  readonly amount?: bigint

  readonly feePriority?: FeePriority
}

/**
 * Intent to revoke a granted allowance.
 *
 * A REVOKE IS A TRANSACTION, NOT A WALLET SETTING. The allowance
 * lives in the contract, not here: removing it takes a call that
 * costs gas and needs a signature. A wallet that shows "revoked"
 * without a confirmed transaction would lie to the owner about
 * the state of their funds.
 */
export interface IRevokeApprovalRequest {
  readonly chainId?: ChainId

  readonly from: Address

  readonly contract: Address

  readonly spender: Address

  /**
   * Contract standard.
   *
   * Decides the call: for tokens the allowance is overwritten
   * with zero (`approve`), for collections the flag is cleared
   * (`setApprovalForAll`).
   */
  readonly standard: TokenStandard

  readonly feePriority?: FeePriority
}

/**
 * A transaction fully ready to sign.
 *
 * Every field is resolved and checked. This is exactly the data
 * set that is signed and that must be shown to the user without
 * any intermediate recalculation "for convenience". A mismatch
 * between what is shown and what is signed is the main class of
 * attacks on a wallet UI.
 */
export interface ISignableTransaction {
  readonly type: TransactionType
  readonly chainId: ChainId
  readonly from: Address
  readonly to: Address | null
  readonly value: Wei
  readonly data: HexString
  readonly nonce: number
  readonly gasLimit: bigint

  readonly maxFeePerGas: bigint | null
  readonly maxPriorityFeePerGas: bigint | null

  readonly gasPrice: bigint | null
}

export interface ISignedTransaction {
  readonly raw: HexString

  readonly hash: TxHash

  readonly transaction: ISignableTransaction
}

export interface IFeeEstimate {
  readonly priority: FeePriority
  readonly maxFeePerGas: bigint | null
  readonly maxPriorityFeePerGas: bigint | null
  readonly gasPrice: bigint | null
  readonly gasLimit: bigint

  /** Upper bound on the charge: `gasLimit * maxFeePerGas`. */
  readonly maxCost: Wei

  /** Expected confirmation time in seconds. `null` if no estimate is available. */
  readonly estimatedSeconds: number | null
}

export interface ITransactionRecord {
  readonly hash: TxHash
  readonly chainId: ChainId
  readonly from: Address
  readonly to: Address | null
  readonly value: Wei
  readonly nonce: number
  readonly status: TransactionStatus
  readonly type: TransactionType

  readonly submittedAt: Timestamp

  /** Time of inclusion in a block. `null` until the transaction is confirmed. */
  readonly confirmedAt: Timestamp | null

  readonly blockNumber: bigint | null
  readonly gasUsed: bigint | null
  readonly effectiveGasPrice: bigint | null

  readonly replacedBy: TxHash | null

  /**
   * Parameters of the original transaction, needed to replace it.
   *
   * WHY STORE THEM. A speed-up is a resend of THE SAME operation
   * at the same nonce with a higher fee. Without the call data
   * and gas limit the wallet would send a different transaction
   * instead of a speed-up — same number, different contents.
   *
   * `null` on records made before replacement existed: there is
   * nowhere to restore those facts after the fact, and pretending
   * they are known is not allowed.
   */
  readonly data: HexString | null
  readonly gasLimit: bigint | null
  readonly maxFeePerGas: bigint | null
  readonly maxPriorityFeePerGas: bigint | null
  readonly gasPrice: bigint | null

  /**
   * How many blocks have confirmed the transaction.
   *
   * Zero until it is included in a block. One means "included in
   * the latest block" — a state from which a reorg can still
   * return it.
   *
   * WHY THIS IS A SEPARATE NUMBER, NOT A "CONFIRMED" FLAG.
   * Inclusion in a block and finality are different things, and
   * the user sees the difference: "in a block" is shown at once,
   * and confirmation depth grows. A flag instead of a number
   * would force one threshold and present it as the truth.
   */
  readonly confirmations: number
}

/**
 * Data for an EIP-712 signature.
 *
 * Signing structured data is more dangerous than signing a
 * transaction: the user signs not a transfer, but an arbitrary
 * message that can then be presented to a contract. The classic
 * example is a `Permit` allowance, giving the right to spend
 * tokens without a separate transaction.
 *
 * The implementation must show the parsed structure, not a raw
 * hash, and check that `domain.chainId` matches the active network.
 */
export interface ITypedData {
  readonly domain: ITypedDataDomain
  readonly types: Readonly<Record<string, readonly ITypedDataField[]>>
  readonly primaryType: string
  readonly message: Readonly<Record<string, unknown>>
}

export interface ITypedDataDomain {
  readonly name?: string
  readonly version?: string
  readonly chainId?: ChainId
  readonly verifyingContract?: Address
  readonly salt?: HexString
}

export interface ITypedDataField {
  readonly name: string
  readonly type: string
}

export interface TransactionEventMap {
  'transaction:submitted': { readonly record: ITransactionRecord }
  'transaction:statusChanged': {
    readonly hash: TxHash
    readonly status: TransactionStatus
  }
}
