import type {
  IAuthUserInput,
  ICreateUserInput,
  IUserRecord,
  IUsersRepository,
} from './contracts.ts'
import { emailsMatch } from './emails.ts'
import { thePMatches } from './theP.ts'

/**
 * Пользователи в памяти процесса.
 *
 * Для проверок маршрута и для локального мока без живой базы.
 */
export class MemoryUsersRepository implements IUsersRepository {
  readonly #records: IUserRecord[] = []
  #nextId = 1

  get records(): readonly IUserRecord[] {
    return this.#records
  }

  create(input: ICreateUserInput): Promise<IUserRecord> {
    const record: IUserRecord = {
      id: String(this.#nextId),
      createdAt: new Date(),
      email: input.email,
      balance: input.balance,
      theP: input.theP,
    }

    this.#nextId += 1
    this.#records.push(record)

    return Promise.resolve(record)
  }

  findById(id: string): Promise<IUserRecord | null> {
    const record = this.#records.find((entry) => entry.id === id)

    return Promise.resolve(record ?? null)
  }

  findByCredentials(input: IAuthUserInput): Promise<IUserRecord | null> {
    const record = this.#records.find(
      (entry) => emailsMatch(entry.email, input.email) && thePMatches(entry.theP, input.theP),
    )

    return Promise.resolve(record ?? null)
  }
}
