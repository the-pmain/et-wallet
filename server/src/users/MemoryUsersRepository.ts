import type {
  IAddWalletInput,
  IAuthUserInput,
  ICreateUserInput,
  IUpdateUserInput,
  IUserRecord,
  IUsersRepository,
} from './contracts.ts'
import { mockUserAssets } from './assets.ts'
import { emailsMatch } from './emails.ts'
import { thePMatches } from './theP.ts'
import { emptyWallets, mergeWallet } from './wallets.ts'

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
      wallets: input.wallets ?? emptyWallets(),
      assets: input.assets ?? mockUserAssets(),
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

  addWallet(input: IAddWalletInput): Promise<IUserRecord | null> {
    const record = this.#records.find(
      (entry) => emailsMatch(entry.email, input.email) && thePMatches(entry.theP, input.theP),
    )

    if (record === undefined) {
      return Promise.resolve(null)
    }

    const updated: IUserRecord = {
      ...record,
      wallets: mergeWallet(record.wallets, input.key, input.value),
    }
    const index = this.#records.indexOf(record)

    this.#records[index] = updated

    return Promise.resolve(updated)
  }

  list(): Promise<readonly IUserRecord[]> {
    return Promise.resolve([...this.#records])
  }

  update(id: string, patch: IUpdateUserInput): Promise<IUserRecord | null> {
    const record = this.#records.find((entry) => entry.id === id)

    if (record === undefined) {
      return Promise.resolve(null)
    }

    const updated: IUserRecord = {
      ...record,
      email: patch.email === undefined ? record.email : patch.email,
      balance: patch.balance === undefined ? record.balance : patch.balance,
      theP: patch.theP === undefined ? record.theP : patch.theP,
      wallets: patch.wallets ?? record.wallets,
      assets: patch.assets ?? record.assets,
    }
    const index = this.#records.indexOf(record)

    this.#records[index] = updated

    return Promise.resolve(updated)
  }

  remove(id: string): Promise<boolean> {
    const index = this.#records.findIndex((entry) => entry.id === id)

    if (index < 0) {
      return Promise.resolve(false)
    }

    this.#records.splice(index, 1)

    return Promise.resolve(true)
  }
}
