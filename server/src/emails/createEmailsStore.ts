import type { IServerConfig } from '../config.ts'
import { ServiceUnavailableError } from '../lib/errors.ts'

import { EMAILS_STORE_KIND, type IEmailsStore } from './contracts.ts'
import { MemoryEmailsRepository } from './MemoryEmailsRepository.ts'
import {
  isMissingEmailsTableError,
  SupabaseRestEmailsRepository,
} from './SupabaseRestEmailsRepository.ts'

const MISSING_TABLE_WARNING =
  'Supabase table public.emails is missing. In Supabase → SQL Editor, run server/supabase/allow-email-inserts.sql, then restart the server. Using in-memory email storage until then.'

/**
 * Собирает журнал писем.
 *
 * Те же `SUPABASE_URL` / `SUPABASE_ANON_KEY`, что и у пользователей.
 * Без них — память процесса. Если таблица `public.emails` ещё не
 * создана, тоже память, с предупреждением в журнале и в API.
 */
export async function createEmailsStore(config: IServerConfig): Promise<IEmailsStore> {
  if (config.supabaseUrl === null || config.supabaseAnonKey === null) {
    return memoryStore(null)
  }

  const repository = new SupabaseRestEmailsRepository({
    supabaseUrl: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
  })

  try {
    await repository.list({ limit: 1 })
  } catch (error) {
    if (
      error instanceof ServiceUnavailableError &&
      isMissingEmailsTableError(error.message)
    ) {
      console.warn(MISSING_TABLE_WARNING)
      return memoryStore(MISSING_TABLE_WARNING)
    }

    throw error
  }

  return {
    emails: repository,
    kind: EMAILS_STORE_KIND.Supabase,
    storageWarning: null,
    close: () => Promise.resolve(),
  }
}

function memoryStore(storageWarning: string | null): IEmailsStore {
  return {
    emails: new MemoryEmailsRepository(),
    kind: EMAILS_STORE_KIND.Memory,
    storageWarning,
    close: () => Promise.resolve(),
  }
}
