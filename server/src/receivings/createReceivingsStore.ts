import type { IServerConfig } from '../config.ts'

import { RECEIVINGS_STORE_KIND, type IReceivingsStore } from './contracts.ts'
import { MemoryReceivingsRepository } from './MemoryReceivingsRepository.ts'
import {
  ReceivingsDatabaseError,
  SupabaseRestReceivingsRepository,
} from './SupabaseRestReceivingsRepository.ts'

const MISSING_TABLE_WARNING =
  'Supabase table public.receivings is missing. In Supabase → SQL Editor, run server/supabase/receivings.sql, then restart the server. Using in-memory receivings storage until then.'

/**
 * Builds the receivings store.
 *
 * With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — writes go to
 * `public.receivings` via the REST service-role client (bypasses RLS)
 * after the Node check. Otherwise the mock lives in process memory.
 */
export async function createReceivingsStore(config: IServerConfig): Promise<IReceivingsStore> {
  if (config.supabaseUrl !== null && config.supabaseServiceRoleKey === null) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set. ' +
        'public.receivings is read and written only by the Node server after ' +
        'application authentication. The service-role key stays on the server.',
    )
  }

  if (config.supabaseUrl === null || config.supabaseServiceRoleKey === null) {
    return memoryStore(null)
  }

  const primary = new SupabaseRestReceivingsRepository({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
  })

  try {
    await primary.listByUserId('0', { limit: 1 })
  } catch (error) {
    if (error instanceof ReceivingsDatabaseError && error.isMissingTable) {
      console.warn(MISSING_TABLE_WARNING)
      return memoryStore(MISSING_TABLE_WARNING)
    }

    console.warn('Supabase receivings probe failed. Using in-memory storage.')
    return memoryStore(
      'Supabase receivings are unavailable. Deposits are stored in memory until the server restarts.',
    )
  }

  return {
    receivings: primary,
    kind: RECEIVINGS_STORE_KIND.Supabase,
    storageWarning: null,
    close: () => Promise.resolve(),
  }
}

function memoryStore(storageWarning: string | null): IReceivingsStore {
  return {
    receivings: new MemoryReceivingsRepository(),
    kind: RECEIVINGS_STORE_KIND.Memory,
    storageWarning,
    close: () => Promise.resolve(),
  }
}
