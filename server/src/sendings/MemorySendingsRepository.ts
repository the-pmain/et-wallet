import { SENDING_STATUS } from './status.ts'
import type {
  ICreateSendingInput,
  ISendingRecord,
  ISendingsRepository,
  IUpdateSendingInput,
} from './contracts.ts'

export class MemorySendingsRepository implements ISendingsRepository {
  readonly #records: ISendingRecord[] = []
  #nextId = 1

  get records(): readonly ISendingRecord[] {
    return this.#records
  }

  create(input: ICreateSendingInput): Promise<ISendingRecord> {
    const record: ISendingRecord = {
      id: String(this.#nextId),
      createdAt: new Date(),
      userId: input.userId,
      status: input.status ?? SENDING_STATUS.Pending,
      failureMessage: input.failureMessage ?? null,
      recipientAddress: input.recipientAddress,
      amount: input.amount,
    }

    this.#nextId += 1
    this.#records.unshift(record)

    return Promise.resolve(record)
  }

  update(id: string, patch: IUpdateSendingInput): Promise<ISendingRecord | null> {
    const index = this.#records.findIndex((entry) => entry.id === id)

    if (index === -1) {
      return Promise.resolve(null)
    }

    const current = this.#records[index]

    if (current === undefined) {
      return Promise.resolve(null)
    }

    const next: ISendingRecord = {
      ...current,
      status: patch.status,
      failureMessage: patch.failureMessage ?? null,
    }

    this.#records[index] = next

    return Promise.resolve(next)
  }

  findById(id: string): Promise<ISendingRecord | null> {
    return Promise.resolve(this.#records.find((entry) => entry.id === id) ?? null)
  }

  listByUserId(userId: string, options?: { readonly limit?: number }): Promise<readonly ISendingRecord[]> {
    const limit = options?.limit ?? 100
    const sorted = this.#records
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())

    return Promise.resolve(sorted.slice(0, limit))
  }
}
