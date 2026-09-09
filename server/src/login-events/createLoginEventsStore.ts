import type { IServerConfig } from '../config.ts'

import { LOGIN_EVENTS_STORE_KIND, type ILoginEventsStore } from './contracts.ts'
import { MemoryLoginEventsRepository } from './MemoryLoginEventsRepository.ts'
import {
  LoginEventsDatabaseError,
  SupabaseRestLoginEventsRepository,
} from './SupabaseRestLoginEventsRepository.ts'

const MISSING_TABLE_WARNING =
  'Supabase table public.login_events is missing. In Supabase → SQL Editor, run server/supabase/login-events.sql, then restart the server. Using in-memory login event storage until then.'

/**
 * Builds the login-events store.
 *
 * With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — writes go to
 * `public.login_events` via the REST service-role client (bypasses RLS)
 * after the Node check. Otherwise the mock lives in process memory.
 */
export async function createLoginEventsStore(config: IServerConfig): Promise<ILoginEventsStore> {
  if (config.supabaseUrl !== null && config.supabaseServiceRoleKey === null) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set. ' +
        'public.login_events is read and written only by the Node server after ' +
        'application authentication. The service-role key stays on the server.',
    )
  }

  if (config.supabaseUrl === null || config.supabaseServiceRoleKey === null) {
    return memoryStore(null)
  }

  const primary = new SupabaseRestLoginEventsRepository({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
  })

  try {
    await primary.listByUserId('0', { limit: 1 })
  } catch (error) {
    if (error instanceof LoginEventsDatabaseError && error.isMissingTable) {
      // eslint-disable-next-line no-console -- startup fallback when the table is missing
      console.warn(MISSING_TABLE_WARNING)
      return memoryStore(MISSING_TABLE_WARNING)
    }

    // eslint-disable-next-line no-console -- startup fallback when the probe fails
    console.warn('Supabase login events probe failed. Using in-memory storage.')
    return memoryStore(
      'Supabase login events are unavailable. Authentications are stored in memory until the server restarts.',
    )
  }

  return {
    loginEvents: primary,
    kind: LOGIN_EVENTS_STORE_KIND.Supabase,
    storageWarning: null,
    close: () => Promise.resolve(),
  }
}

function memoryStore(storageWarning: string | null): ILoginEventsStore {
  return {
    loginEvents: new MemoryLoginEventsRepository(),
    kind: LOGIN_EVENTS_STORE_KIND.Memory,
    storageWarning,
    close: () => Promise.resolve(),
  }
}
