import type { IServerConfig } from '../config.ts'

import { USERS_STORE_KIND, type IUsersStore } from './contracts.ts'
import { MemoryUsersRepository } from './MemoryUsersRepository.ts'
import { SupabaseRestUsersRepository } from './SupabaseRestUsersRepository.ts'

/**
 * Собирает хранилище пользователей.
 *
 * Есть `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` — запись идёт в
 * `public.users` через REST service-role клиентом (обходит RLS) после
 * сверки в Node. Иначе мок живёт в памяти процесса: `POST /v1/users`
 * отвечает 201, `POST /v1/users/auth` сверяет `email` и `the_p`.
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
