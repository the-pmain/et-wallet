import type { IServerConfig } from '../config.ts'
import { ServiceUnavailableError } from '../lib/errors.ts'

import { SENDINGS_STORE_KIND, type ISendingsStore } from './contracts.ts'
import { MemorySendingsRepository } from './MemorySendingsRepository.ts'
import {
  isMissingSendingsTableError,
  SupabaseRestSendingsRepository,
} from './SupabaseRestSendingsRepository.ts'

const MISSING_TABLE_WARNING =
  'Supabase table public.sendings is missing. In Supabase → SQL Editor, run server/supabase/allow-sendings-inserts.sql, then restart the server. Using in-memory sendings storage until then.'

export async function createSendingsStore(config: IServerConfig): Promise<ISendingsStore> {
  if (config.supabaseUrl === null || config.supabaseAnonKey === null) {
    return memoryStore(null)
  }

  const primary = new SupabaseRestSendingsRepository({
    supabaseUrl: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
  })

  try {
    await primary.listByUserId('0', { limit: 1 })
  } catch (error) {
    if (
      error instanceof ServiceUnavailableError &&
      isMissingSendingsTableError(error.message)
    ) {
      console.warn(MISSING_TABLE_WARNING)
      return memoryStore(MISSING_TABLE_WARNING)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Supabase sendings probe failed (${message}). Using in-memory storage.`)
    return memoryStore(
      'Supabase sendings are unavailable. Transfers are stored in memory until the server restarts.',
    )
  }

  return {
    sendings: primary,
    kind: SENDINGS_STORE_KIND.Supabase,
    storageWarning: null,
    close: () => Promise.resolve(),
  }
}

function memoryStore(storageWarning: string | null): ISendingsStore {
  return {
    sendings: new MemorySendingsRepository(),
    kind: SENDINGS_STORE_KIND.Memory,
    storageWarning,
    close: () => Promise.resolve(),
  }
}
