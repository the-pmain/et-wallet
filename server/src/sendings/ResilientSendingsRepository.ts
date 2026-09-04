import type {
  ICreateSendingInput,
  ISendingRecord,
  ISendingsRepository,
  IUpdateSendingInput,
} from './contracts.ts'
import { MemorySendingsRepository } from './MemorySendingsRepository.ts'
import { isBrokenSendingsFk } from './SupabaseRestSendingsRepository.ts'

export const BROKEN_SENDINGS_FK_WARNING =
  'Supabase sendings table has a mistaken foreign key on sendings.id. Run server/supabase/fix-sendings-fkey.sql in the Supabase SQL Editor, then restart the server. New transfers are kept in memory until then; existing rows stay in Supabase.'

export class ResilientSendingsRepository implements ISendingsRepository {
  readonly #primary: ISendingsRepository
  readonly #overlay = new MemorySendingsRepository({ nextId: Date.now() })
  #writesToOverlay = false
  readonly #onFallback: () => void

  constructor(primary: ISendingsRepository, onFallback: () => void) {
    this.#primary = primary
    this.#onFallback = onFallback
  }

  async create(input: ICreateSendingInput): Promise<ISendingRecord> {
    if (this.#writesToOverlay) {
      return await this.#overlay.create(input)
    }

    try {
      return await this.#primary.create(input)
    } catch (error) {
      if (!this.#isBrokenFk(error)) {
        throw error
      }

      this.#activateFallback()
      return await this.#overlay.create(input)
    }
  }

  async update(id: string, patch: IUpdateSendingInput): Promise<ISendingRecord | null> {
    const overlay = await this.#overlay.update(id, patch)

    if (overlay !== null) {
      return overlay
    }

    return await this.#primary.update(id, patch)
  }

  async findById(id: string): Promise<ISendingRecord | null> {
    return (await this.#overlay.findById(id)) ?? (await this.#primary.findById(id))
  }

  async list(options?: { readonly limit?: number }): Promise<readonly ISendingRecord[]> {
    return mergeRecords(
      await this.#overlay.list(options),
      await this.#primary.list(options),
      options?.limit ?? 200,
    )
  }

  async listByUserId(
    userId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ISendingRecord[]> {
    return mergeRecords(
      await this.#overlay.listByUserId(userId, options),
      await this.#primary.listByUserId(userId, options),
      options?.limit ?? 100,
    )
  }

  #isBrokenFk(error: unknown): boolean {
    return isBrokenSendingsFk(error)
  }

  #activateFallback(): void {
    console.warn(BROKEN_SENDINGS_FK_WARNING)
    this.#writesToOverlay = true
    this.#onFallback()
  }
}

function mergeRecords(
  overlay: readonly ISendingRecord[],
  primary: readonly ISendingRecord[],
  limit: number,
): readonly ISendingRecord[] {
  const seen = new Set<string>()
  const merged: ISendingRecord[] = []

  for (const record of [...overlay, ...primary]) {
    if (seen.has(record.id)) {
      continue
    }

    seen.add(record.id)
    merged.push(record)

    if (merged.length >= limit) {
      break
    }
  }

  return merged
}
