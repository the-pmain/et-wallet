import type {
  ICreateLoginEventInput,
  ILoginEventRecord,
  ILoginEventsRepository,
} from './contracts.ts'

/**
 * Login events in process memory.
 *
 * For route checks and a local mock without a live database.
 */
export class MemoryLoginEventsRepository implements ILoginEventsRepository {
  readonly #records: ILoginEventRecord[] = []

  get records(): readonly ILoginEventRecord[] {
    return this.#records
  }

  create(input: ICreateLoginEventInput): Promise<ILoginEventRecord> {
    const record: ILoginEventRecord = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      userId: input.userId,
    }

    this.#records.unshift(record)

    return Promise.resolve(record)
  }

  list(options?: { readonly limit?: number }): Promise<readonly ILoginEventRecord[]> {
    const limit = options?.limit ?? 5000
    const sorted = [...this.#records].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )

    return Promise.resolve(sorted.slice(0, limit))
  }

  listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ILoginEventRecord[]> {
    const limit = options?.limit ?? 1000
    const sorted = this.#records
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())

    return Promise.resolve(sorted.slice(0, limit))
  }
}
