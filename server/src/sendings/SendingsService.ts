import { hasAddressShape } from '../lib/address.ts'
import type { IUsersRepository } from '../users/contracts.ts'
import { debitToken, findTokenBySymbol, toTokenUnits } from '../users/debit-token.ts'
import { isKnownTokenSymbol } from '../users/token-symbols.ts'

import { readSendingAmount } from './amount.ts'
import type { ISendingRecord, ISendingsRepository } from './contracts.ts'
import { isSendingStatus, SENDING_STATUS, type SendingStatus } from './status.ts'
import { readSendingSymbol } from './symbol.ts'

export interface IRegisterSendingInput {
  readonly userId: string
  readonly email: string
  readonly theP: string
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}

export class SendingsService {
  readonly #sendings: ISendingsRepository
  readonly #users: IUsersRepository

  constructor(sendings: ISendingsRepository, users: IUsersRepository) {
    this.#sendings = sendings
    this.#users = users
  }

  async register(input: IRegisterSendingInput): Promise<ISendingRecord> {
    const user = await this.#users.findByCredentials({
      email: input.email,
      theP: input.theP,
    })

    if (user === null || user.id !== input.userId.trim()) {
      throw new SendingsAuthError('Invalid credentials.')
    }

    const failureMessage = validateSending(input)

    if (failureMessage !== null) {
      throw new SendingsValidationError(failureMessage)
    }

    const amount = readSendingAmount(input.amount) ?? input.amount.trim()
    const symbol = readSendingSymbol(input.symbol)

    if (symbol === null) {
      throw new SendingsValidationError('Asset symbol is required.')
    }

    return await this.#sendings.create({
      userId: user.id,
      status: SENDING_STATUS.Pending,
      recipientAddress: input.recipientAddress.trim(),
      amount,
      symbol,
    })
  }

  async list(options?: { readonly limit?: number }): Promise<readonly ISendingRecord[]> {
    return await this.#sendings.list(options)
  }

  async update(id: string, patch: IUpdateSendingFields): Promise<ISendingRecord | null> {
    const failureMessage = validateSending({
      recipientAddress: patch.recipientAddress,
      amount: patch.amount,
      symbol: patch.symbol,
    })

    if (failureMessage !== null) {
      throw new SendingsValidationError(failureMessage)
    }

    if (!isSendingStatus(patch.status)) {
      throw new SendingsValidationError('Status is required.')
    }

    const amount = readSendingAmount(patch.amount) ?? patch.amount.trim()
    const symbol = readSendingSymbol(patch.symbol)

    if (symbol === null) {
      throw new SendingsValidationError('Asset symbol is required.')
    }

    const current = await this.#sendings.findById(id)

    if (current === null) {
      return null
    }

    if (patch.status === SENDING_STATUS.Success && current.status !== SENDING_STATUS.Success) {
      await this.#debitUserToken(current.userId, symbol, amount)
    }

    return await this.#sendings.update(id, {
      status: patch.status,
      failureMessage: emptyToNull(patch.failureMessage),
      recipientAddress: patch.recipientAddress.trim(),
      amount,
      symbol,
    })
  }

  async #debitUserToken(userId: string | null, symbol: string, amount: string): Promise<void> {
    if (userId === null || userId === '') {
      throw new SendingsValidationError('User for this sending was not found.')
    }

    const user = await this.#users.findById(userId)

    if (user === null) {
      throw new SendingsValidationError('User for this sending was not found.')
    }

    const token = findTokenBySymbol(user.assets.tokens, symbol)

    if (token === null) {
      throw new SendingsValidationError(`Asset ${symbol} was not found in the user tokens.`)
    }

    const units = toTokenUnits(amount, token.decimals)

    if (units === null) {
      throw new SendingsValidationError('Sending amount does not match the token decimals.')
    }

    await this.#users.update(user.id, {
      assets: debitToken(user.assets, token, units),
    })
  }
}

export interface IUpdateSendingFields {
  readonly status: SendingStatus
  readonly failureMessage: string | null
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}

function validateSending(input: {
  readonly recipientAddress: string
  readonly amount: string
  readonly symbol: string
}): string | null {
  const recipient = input.recipientAddress.trim()
  const amount = input.amount.trim()

  if (recipient === '') {
    return 'Recipient address is required.'
  }

  if (!hasAddressShape(recipient)) {
    return 'Recipient address must be a valid EVM address.'
  }

  if (readSendingAmount(amount) === null) {
    return 'Amount must be a number.'
  }

  if (readSendingSymbol(input.symbol) === null) {
    return 'Asset symbol is required.'
  }

  if (!isKnownTokenSymbol(input.symbol)) {
    return 'Unknown asset symbol.'
  }

  return null
}

export class SendingsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendingsAuthError'
  }
}

export class SendingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendingsValidationError'
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
