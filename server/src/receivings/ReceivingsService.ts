import type { IUsersRepository } from '../users/contracts.ts'
import { findTokenBySymbol, setTokenBalance, toTokenUnits } from '../users/debit-token.ts'
import { readSendingAmount } from '../sendings/amount.ts'
import { isSendingStatus, SENDING_STATUS, type SendingStatus } from '../sendings/status.ts'
import { readSendingSymbol } from '../sendings/symbol.ts'

import type { IReceivingRecord, IReceivingsRepository } from './contracts.ts'

export interface IRegisterReceivingInput {
  readonly userId: string
  readonly status?: SendingStatus
  readonly failureMessage?: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

export class ReceivingsService {
  readonly #receivings: IReceivingsRepository
  readonly #users: IUsersRepository

  constructor(receivings: IReceivingsRepository, users: IUsersRepository) {
    this.#receivings = receivings
    this.#users = users
  }

  async register(input: IRegisterReceivingInput): Promise<IReceivingRecord> {
    const fields = readReceivingFields(input)
    const user = await this.#users.findById(input.userId.trim())

    if (user === null) {
      throw new ReceivingsValidationError('User for this receiving was not found.')
    }

    const status = input.status ?? SENDING_STATUS.Pending

    if (status === SENDING_STATUS.Success) {
      await this.#applyUserToken(user.id, fields.symbol, fields.amount)
    }

    return await this.#receivings.create({
      userId: user.id,
      status,
      failureMessage: emptyToNull(input.failureMessage ?? null),
      recipientAddress: emptyToNull(input.recipientAddress ?? null),
      amount: fields.amount,
      symbol: fields.symbol,
      usdAmount: emptyToNull(input.usdAmount ?? null),
    })
  }

  async list(options?: { readonly limit?: number }): Promise<readonly IReceivingRecord[]> {
    return await this.#receivings.list(options)
  }

  async listByUserId(userId: string): Promise<readonly IReceivingRecord[]> {
    return await this.#receivings.listByUserId(userId.trim())
  }

  async listForUser(input: {
    readonly userId: string
    readonly email: string
    readonly theP: string
  }): Promise<readonly IReceivingRecord[]> {
    const user = await this.#users.findByCredentials({
      email: input.email,
      theP: input.theP,
    })

    if (user === null || user.id !== input.userId.trim()) {
      throw new ReceivingsAuthError('Invalid credentials.')
    }

    const owned = await this.#receivings.listByUserId(user.id)

    if (owned.length > 0) {
      return owned
    }

    const listed = await this.#receivings.list({ limit: 200 })

    return listed.filter((record) => record.userId !== null && record.userId === user.id)
  }

  async update(id: string, patch: IUpdateReceivingFields): Promise<IReceivingRecord | null> {
    const fields = readReceivingFields(patch)

    if (!isSendingStatus(patch.status)) {
      throw new ReceivingsValidationError('Status is required.')
    }

    const current = await this.#receivings.findById(id)

    if (current === null) {
      return null
    }

    if (patch.status === SENDING_STATUS.Success && current.status !== SENDING_STATUS.Success) {
      await this.#applyUserToken(current.userId, fields.symbol, fields.amount)
    }

    return await this.#receivings.update(id, {
      status: patch.status,
      failureMessage: emptyToNull(patch.failureMessage),
      recipientAddress: emptyToNull(patch.recipientAddress ?? null),
      amount: fields.amount,
      symbol: fields.symbol,
      usdAmount: emptyToNull(patch.usdAmount ?? null),
    })
  }

  async #applyUserToken(userId: string | null, symbol: string, amount: string): Promise<void> {
    if (userId === null || userId === '') {
      throw new ReceivingsValidationError('User for this receiving was not found.')
    }

    const user = await this.#users.findById(userId)

    if (user === null) {
      throw new ReceivingsValidationError('User for this receiving was not found.')
    }

    const token = findTokenBySymbol(user.assets.tokens, symbol)

    if (token === null) {
      return
    }

    const units = toTokenUnits(amount, token.decimals)

    if (units === null) {
      throw new ReceivingsValidationError('Receiving amount does not match the token decimals.')
    }

    await this.#users.update(user.id, {
      assets: setTokenBalance(user.assets, token, units),
    })
  }
}

export interface IUpdateReceivingFields {
  readonly status: SendingStatus
  readonly failureMessage: string | null
  readonly recipientAddress?: string | null
  readonly amount: string
  readonly symbol: string
  readonly usdAmount?: string | null
}

function readReceivingFields(input: { readonly amount: string; readonly symbol: string }): {
  readonly amount: string
  readonly symbol: string
} {
  const amount = readSendingAmount(input.amount)

  if (amount === null) {
    throw new ReceivingsValidationError('Amount must be a number.')
  }

  const symbol = readSendingSymbol(input.symbol)

  if (symbol === null) {
    throw new ReceivingsValidationError('Asset symbol is required.')
  }

  return { amount, symbol }
}

export class ReceivingsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceivingsAuthError'
  }
}

export class ReceivingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceivingsValidationError'
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
