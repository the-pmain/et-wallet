import { hasAddressShape } from '../lib/address.ts'
import type { IUsersRepository } from '../users/contracts.ts'

import { readSendingAmount } from './amount.ts'
import type { ISendingRecord, ISendingsRepository } from './contracts.ts'
import { SENDING_STATUS } from './status.ts'

export interface IRegisterSendingInput {
  readonly userId: string
  readonly email: string
  readonly theP: string
  readonly recipientAddress: string
  readonly amount: string
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

    const amount = readSendingAmount(input.amount) ?? input.amount.trim()

    const pending = await this.#sendings.create({
      userId: user.id,
      status: SENDING_STATUS.Pending,
      recipientAddress: input.recipientAddress.trim(),
      amount,
    })

    const failureMessage = validateSending(input)

    if (failureMessage !== null) {
      const failed = await this.#sendings.update(pending.id, {
        status: SENDING_STATUS.Failure,
        failureMessage,
      })

      return failed ?? pending
    }

    const completed = await this.#sendings.update(pending.id, {
      status: SENDING_STATUS.Success,
      failureMessage: null,
    })

    return completed ?? pending
  }
}

function validateSending(input: IRegisterSendingInput): string | null {
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

  return null
}

export class SendingsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendingsAuthError'
  }
}
