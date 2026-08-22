import { ServiceUnavailableError } from '../lib/errors.ts'

import type {
  ICreateSendingInput,
  ISendingRecord,
  ISendingsRepository,
  IUpdateSendingInput,
} from './contracts.ts'
import { MemorySendingsRepository } from './MemorySendingsRepository.ts'
import { isBrokenSendingsIdFkError } from './SupabaseRestSendingsRepository.ts'

export const BROKEN_SENDINGS_FK_WARNING =
  'Supabase sendings table has a mistaken foreign key on sendings.id. Run server/supabase/fix-sendings-fkey.sql in the Supabase SQL Editor, then restart the server. Using in-memory sendings storage until then.'

export class ResilientSendingsRepository implements ISendingsRepository {
  readonly #primary: ISendingsRepository
  #active: ISendingsRepository
  readonly #onFallback: () => void

  constructor(primary: ISendingsRepository, onFallback: () => void) {
    this.#primary = primary
    this.#active = primary
    this.#onFallback = onFallback
  }

  create(input: ICreateSendingInput): Promise<ISendingRecord> {
    return this.#withFallback((repo) => repo.create(input))
  }

  update(id: string, patch: IUpdateSendingInput): Promise<ISendingRecord | null> {
    return this.#withFallback((repo) => repo.update(id, patch))
  }

  findById(id: string): Promise<ISendingRecord | null> {
    return this.#withFallback((repo) => repo.findById(id))
  }

  listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ISendingRecord[]> {
    return this.#withFallback((repo) => repo.listByUserId(userId, options))
  }

  async #withFallback<T>(operation: (repo: ISendingsRepository) => Promise<T>): Promise<T> {
    try {
      return await operation(this.#active)
    } catch (error) {
      if (!this.#shouldFallback(error)) {
        throw error
      }

      this.#activateFallback()
      return await operation(this.#active)
    }
  }

  #shouldFallback(error: unknown): boolean {
    return (
      this.#active === this.#primary &&
      error instanceof ServiceUnavailableError &&
      isBrokenSendingsIdFkError(error.message)
    )
  }

  #activateFallback(): void {
    console.warn(BROKEN_SENDINGS_FK_WARNING)
    this.#active = new MemorySendingsRepository()
    this.#onFallback()
  }
}
