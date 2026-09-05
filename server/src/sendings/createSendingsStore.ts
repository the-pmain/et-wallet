import type { IServerConfig } from '../config.ts'

import { SENDINGS_STORE_KIND, type ISendingsStore } from './contracts.ts'
import { MemorySendingsRepository } from './MemorySendingsRepository.ts'
import {
  BROKEN_SENDINGS_FK_WARNING,
  ResilientSendingsRepository,
} from './ResilientSendingsRepository.ts'
import {
  SendingsDatabaseError,
  SupabaseRestSendingsRepository,
} from './SupabaseRestSendingsRepository.ts'

const MISSING_TABLE_WARNING =
  'Supabase table public.sendings is missing. In Supabase → SQL Editor, run server/supabase/allow-sendings-inserts.sql and server/supabase/sendings-rls.sql, then restart the server. Using in-memory sendings storage until then.'

/**
 * Builds the sendings store.
 *
 * With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — writes go to
 * `public.sendings` via the REST service-role client (bypasses RLS)
 * after the Node check. Otherwise the mock lives in process memory.
 */
export async function createSendingsStore(config: IServerConfig): Promise<ISendingsStore> {
  if (config.supabaseUrl !== null && config.supabaseServiceRoleKey === null) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set. ' +
        'public.sendings is read and written only by the Node server after ' +
        'application authentication. The service-role key stays on the server.',
    )
  }

  if (config.supabaseUrl === null || config.supabaseServiceRoleKey === null) {
    return memoryStore(null)
  }

  const primary = new SupabaseRestSendingsRepository({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
  })

  try {
    await primary.listByUserId('0', { limit: 1 })
  } catch (error) {
    if (error instanceof SendingsDatabaseError && error.isMissingTable) {
      console.warn(MISSING_TABLE_WARNING)
      return memoryStore(MISSING_TABLE_WARNING)
    }

    console.warn('Supabase sendings probe failed. Using in-memory storage.')
    return memoryStore(
      'Supabase sendings are unavailable. Transfers are stored in memory until the server restarts.',
    )
  }

  let storageWarning: string | null = null

  return {
    sendings: new ResilientSendingsRepository(primary, () => {
      storageWarning = BROKEN_SENDINGS_FK_WARNING
    }),
    kind: SENDINGS_STORE_KIND.Supabase,
    get storageWarning() {
      return storageWarning
    },
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
