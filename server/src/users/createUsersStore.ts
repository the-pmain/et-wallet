import type { IServerConfig } from '../config.ts'

import { USERS_STORE_KIND, type IUsersStore } from './contracts.ts'
import { MemoryUsersRepository } from './MemoryUsersRepository.ts'
import { SupabaseRestUsersRepository } from './SupabaseRestUsersRepository.ts'

/**
 * Собирает хранилище пользователей.
 *
 * Есть `SUPABASE_URL` и `SUPABASE_ANON_KEY` — запись идёт в таблицу
 * через REST. Иначе мок живёт в памяти процесса: `POST /v1/users`
 * отвечает 201, `POST /v1/users/auth` сверяет `email` и `the_p`.
 */
export function createUsersStore(config: IServerConfig): IUsersStore {
  if (config.supabaseUrl !== null && config.supabaseAnonKey !== null) {
    return {
      users: new SupabaseRestUsersRepository({
        supabaseUrl: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
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
