/**
 * The item does not belong to the sender.
 *
 * CHECKED BEFORE SIGNING. The contract would revert the call itself,
 * but gas would still be spent and the refusal reason would stay
 * unclear. The owner may have given the item away from another device
 * or be looking at a stale list — both must be named plainly.
 */
export class NftNotOwnedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NftNotOwned

  constructor(reason: string) {
    super(`The item cannot be sent: ${reason}.`)
  }
}

/**
 * The token balance is lower than the amount being sent.
 *
 * CHECKED SEPARATELY FROM THE NATIVE BALANCE. There may be enough for
 * the fee and not enough tokens; the contract then reverts, gas is
 * spent, and no transfer happens. A node's gas-estimate refusal only
 * says "the call will revert" and does not name the reason.
 */
export class InsufficientTokenBalanceError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsufficientTokenBalance

  readonly required: bigint

  readonly available: bigint

  constructor(required: bigint, available: bigint) {
    super('The token balance is lower than the amount being sent.')
    this.required = required
    this.available = available
  }
}

/**
 * The transaction cannot be replaced.
 *
 * The reason is named verbatim and shown to the user: "could not
 * speed up" without explanation leaves the owner alone with a stuck
 * transfer, and the reasons need different actions — wait, update the
 * app, or do nothing because the transfer already went through.
 */
export class TransactionNotReplaceableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionNotReplaceable

  constructor(reason: string) {
    super(`The transaction cannot be replaced: ${reason}.`)
  }
}
import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * Insufficient funds.
 *
 * Amounts are passed as `bigint` and not formatted: conversion to a
 * readable form depends on the currency `decimals` and locale
 * settings, i.e. belongs to the presentation layer.
 */
export class InsufficientFundsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsufficientFunds

  readonly required: bigint

  readonly available: bigint

  constructor(required: bigint, available: bigint) {
    super('There are not enough funds for this operation.')
    this.required = required
    this.available = available
  }
}

/**
 * The gas limit could not be estimated.
 *
 * Almost always means the contract call will revert. Sending a
 * transaction with an arbitrarily assigned limit in that situation
 * is forbidden: gas would be spent and the operation would not run.
 */
export class GasEstimationFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.GasEstimationFailed

  /**
   * Revert data returned by the contract.
   *
   * KEPT RAW because it cannot always be decoded. A standard
   * `Error(string)` reason is unpacked by the library, but custom
   * contract errors are a four-byte selector whose meaning is
   * unknown without the contract ABI. Showing the selector itself is
   * more honest than replacing it with "call rejected": the selector
   * can be looked up, a generic phrase cannot.
   *
   * `null` — the node returned no data.
   */
  readonly revertData: string | null

  /**
   * Reason separate from the error text.
   *
   * The text describes a failed gas estimate; the reason belongs to
   * the call and is usable where estimation is not the topic: on a
   * pre-sign call check, "could not estimate gas" would mislead.
   */
  readonly reason: string

  constructor(reason: string, options?: ErrorOptions & { readonly revertData?: string | null }) {
    super(`The gas limit could not be estimated: ${reason}`, options)

    this.reason = reason
    this.revertData = options?.revertData ?? null
  }
}

export class NonceTooLowError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NonceTooLow

  readonly provided: number

  readonly expected: number

  constructor(provided: number, expected: number) {
    super(`Nonce ${String(provided)} has already been used. Expected ${String(expected)}.`)
    this.provided = provided
    this.expected = expected
  }
}

export class TransactionNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionNotFound

  constructor(hash: string) {
    super(`Transaction was not found: ${hash}`)
  }
}

/**
 * The gas price is below the node's minimum acceptable.
 *
 * Arises when speeding up or cancelling transactions: a replacement
 * must offer a higher price than the original, or the node rejects it.
 */
export class TransactionUnderpricedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionUnderpriced

  constructor() {
    super('The offered gas price is too low to replace the transaction.')
  }
}

/**
 * The user rejected the operation.
 *
 * Matches EIP-1193 code 4001. This is NOT a failure: the dApp must
 * receive exactly this code to distinguish a user refusal from a
 * technical error and not show them an error message.
 */
export class UserRejectedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UserRejected

  static readonly EIP1193_CODE = 4001

  constructor(operation: string) {
    super(`The operation was rejected: ${operation}`)
  }
}

export class TokenNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TokenNotFound

  constructor(address: string) {
    super(`Token was not found: ${address}`)
  }
}

export class InvalidTokenContractError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidTokenContract

  constructor(address: string, reason: string) {
    super(`Contract ${address} is unusable: ${reason}`)
  }
}

/**
 * The contract impersonates a verified token.
 *
 * Token symbol and name are set by the contract author: a string the
 * contract returns on request, not a network property. Anyone can
 * call themselves `USDC`, and an owner who sees a familiar symbol in
 * the list will send funds to it or grant an allowance.
 *
 * Handling: show which token the contract impersonates, name the
 * genuine address, and add only on explicit consent.
 */
export class TokenImpersonationError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TokenImpersonation

  readonly genuineAddress: string

  readonly foreignCharacters: readonly string[]

  constructor(
    impersonatedSymbol: string,
    genuineAddress: string,
    actualAddress: string,
    foreignCharacters: readonly string[] = [],
  ) {
    super(
      (foreignCharacters.length === 0
        ? `The contract ${actualAddress} calls itself "${impersonatedSymbol}", `
        : `The contract ${actualAddress} calls itself "${impersonatedSymbol}" using letters ` +
          `from another alphabet (${foreignCharacters.join(' ')}), `) +
        `but the verified token with that name is ${genuineAddress}. ` +
        'Naming a contract after a well-known token is the usual way to make someone ' +
        'send funds to a worthless one.',
    )
    this.genuineAddress = genuineAddress
    this.foreignCharacters = foreignCharacters
  }
}

export class UnsupportedTokenStandardError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UnsupportedTokenStandard

  constructor(standard: string) {
    super(`Token standard is not supported: ${standard}`)
  }
}
