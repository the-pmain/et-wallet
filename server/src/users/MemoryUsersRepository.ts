import type { ICreateUserInput, IUserRecord, IUsersRepository } from './contracts.ts'

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
      username: input.username,
      balance: input.balance,
      theP: input.theP,
    }

    this.#nextId += 1
    this.#records.push(record)

    return Promise.resolve(record)
  }
}
