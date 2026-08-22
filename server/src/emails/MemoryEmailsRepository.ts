import {
  EMAIL_DIRECTION,
  type EmailDirection,
  type ICreateEmailInput,
  type IEmailRecord,
  type IEmailsRepository,
} from './contracts.ts'

/**
 * Журнал писем в памяти процесса.
 *
 * Для тестов и локального мока без таблицы Supabase.
 */
export class MemoryEmailsRepository implements IEmailsRepository {
  readonly #records: IEmailRecord[] = []
  #nextId = 1

  get records(): readonly IEmailRecord[] {
    return this.#records
  }

  create(input: ICreateEmailInput): Promise<IEmailRecord> {
    const record: IEmailRecord = {
      id: String(this.#nextId),
      createdAt: new Date(),
      direction: input.direction,
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html ?? null,
      text: input.text ?? null,
      status: input.status,
      providerResult: input.providerResult ?? null,
      externalId: input.externalId ?? null,
    }

    this.#nextId += 1
    this.#records.unshift(record)

    return Promise.resolve(record)
  }

  list(options?: { readonly limit?: number }): Promise<readonly IEmailRecord[]> {
    const limit = options?.limit ?? 100
    const sorted = [...this.#records].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )

    return Promise.resolve(sorted.slice(0, limit))
  }

  findById(id: string): Promise<IEmailRecord | null> {
    return Promise.resolve(this.#records.find((entry) => entry.id === id) ?? null)
  }

  findByExternalId(externalId: string): Promise<IEmailRecord | null> {
    return Promise.resolve(
      this.#records.find((entry) => entry.externalId === externalId) ?? null,
    )
  }
}

export function isEmailDirection(value: unknown): value is EmailDirection {
  return value === EMAIL_DIRECTION.Sent || value === EMAIL_DIRECTION.Received
}
