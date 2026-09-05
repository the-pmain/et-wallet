import type { IServerConfig } from '../config.ts'

import { USERS_STORE_KIND, type IUsersStore } from './contracts.ts'
import { MemoryUsersRepository } from './MemoryUsersRepository.ts'
import { SupabaseRestUsersRepository } from './SupabaseRestUsersRepository.ts'

/**
 * Builds the users store.
 *
 * With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — writes go to
 * `public.users` via the REST service-role client (bypasses RLS) after
 * the Node check. Otherwise the mock lives in process memory:
 * `POST /v1/users` answers 201, `POST /v1/users/auth` checks `email`
 * and `the_p`.
 */
export function createUsersStore(config: IServerConfig): IUsersStore {
  if (config.supabaseUrl !== null && config.supabaseServiceRoleKey === null) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set. ' +
        'public.users is read and written only by the Node server after ' +
        'application authentication. The service-role key stays on the server.',
    )
  }

  if (config.supabaseUrl !== null && config.supabaseServiceRoleKey !== null) {
    return {
      users: new SupabaseRestUsersRepository({
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      }),
      kind: USERS_STORE_KIND.Supabase,
      close: () => Promise.resolve(),
    }
  }

  return {
    users: new MemoryUsersRepository(),
    kind: USERS_STORE_KIND.Memory,
    close: () => Promise.resolve(),
  }
}
