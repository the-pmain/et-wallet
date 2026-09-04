import { UnauthorizedError } from '../lib/errors.ts'

/**
 * Клиенты Supabase только для `public.users`.
 *
 * User-scoped клиент: `SUPABASE_URL` + publishable/anon и заголовок
 * `Authorization` текущего запроса. Service-role ключ сюда не входит.
 *
 * Admin-клиент: `SUPABASE_SERVICE_ROLE_KEY` обходит RLS. Только после
 * сверки на сервере (`email`+`the_p` или `x-admin-pin`). Не выбирать
 * по полю тела запроса вроде `{ "role": "admin" }`.
 */

export interface ISupabaseAuthUser {
  readonly id: string
  readonly email: string | null
}

export interface ISupabaseAuthResult {
  readonly data: { readonly user: ISupabaseAuthUser | null }
  readonly error: { readonly code: string } | null
}

export interface ISupabaseUserClient {
  readonly kind: 'user'
  readonly auth: {
    getUser(token: string): Promise<ISupabaseAuthResult>
  }
  readonly headers: Readonly<Record<string, string>>
}

export interface ISupabaseAdminClient {
  readonly kind: 'admin'
  readonly headers: Readonly<Record<string, string>>
}

export interface ISupabaseUserClientOptions {
  readonly supabaseUrl: string
  readonly publishableKey: string
  readonly fetch?: typeof fetch
}

export interface ISupabaseAdminClientOptions {
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly fetch?: typeof fetch
}

/** Publishable, иначе anon. Service-role сюда не подставляется. */
export function readSupabasePublishableKey(
  publishableKey: string | null,
  anonKey: string | null,
): string | null {
  return publishableKey ?? anonKey
}

/**
 * Полный `Authorization: Bearer …` текущего запроса.
 *
 * `null` — заголовка нет или это не Bearer.
 */
export function readBearerAuthorization(
  authorization: string | readonly string[] | undefined,
): string | null {
  const raw = firstAuthorizationValue(authorization)

  if (raw === null) {
    return null
  }

  if (!raw.startsWith('Bearer ')) {
    return null
  }

  const token = raw.slice('Bearer '.length).trim()

  if (token === '') {
    return null
  }

  return `Bearer ${token}`
}

export function requireBearerAuthorization(
  authorization: string | readonly string[] | undefined,
): string {
  const header = readBearerAuthorization(authorization)

  if (header === null) {
    throw new UnauthorizedError('Неверные учётные данные.')
  }

  return header
}

/**
 * User-scoped клиент: publishable/anon + JWT запроса.
 *
 * Не использует `SUPABASE_SERVICE_ROLE_KEY`.
 */
export function createSupabaseUserClient(
  authorizationHeader: string,
  options: ISupabaseUserClientOptions,
): ISupabaseUserClient {
  const header = readBearerAuthorization(authorizationHeader)

  if (header === null) {
    throw new UnauthorizedError('Неверные учётные данные.')
  }

  const url = options.supabaseUrl.replace(/\/$/u, '')
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)

  return {
    kind: 'user',
    headers: {
      apikey: options.publishableKey,
      authorization: header,
      accept: 'application/json',
    },
    auth: {
      getUser: async (presentedToken: string): Promise<ISupabaseAuthResult> => {
        const response = await request(`${url}/auth/v1/user`, {
          method: 'GET',
          headers: {
            apikey: options.publishableKey,
            authorization: `Bearer ${presentedToken}`,
            accept: 'application/json',
          },
        })

        if (!response.ok) {
          return { data: { user: null }, error: { code: 'unauthorized' } }
        }

        const user = readAuthUser(await response.text())

        if (user === null) {
          return { data: { user: null }, error: { code: 'unauthorized' } }
        }

        return { data: { user }, error: null }
      },
    },
  }
}

/**
 * Доверенный серверный клиент.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` обходит RLS. Только после авторизации
 * в Node. Не для обычного «чтобы не писать политики».
 */
export function createSupabaseAdminClient(options: ISupabaseAdminClientOptions): ISupabaseAdminClient {
  return {
    kind: 'admin',
    headers: {
      apikey: options.serviceRoleKey,
      authorization: `Bearer ${options.serviceRoleKey}`,
      accept: 'application/json',
    },
  }
}

/**
 * Сверяет Bearer с Supabase Auth. Нет или просрочен — 401.
 *
 * Для маршрутов, где личность берётся из JWT. Существующие
 * `/v1/users` сверяют `email` и `the_p`, не этот заголовок.
 */
export async function authenticateSupabaseBearerUser(
  authorization: string | readonly string[] | undefined,
  options: ISupabaseUserClientOptions,
): Promise<{ readonly user: ISupabaseAuthUser } | { readonly statusCode: 401 }> {
  const header = readBearerAuthorization(authorization)

  if (header === null) {
    return { statusCode: 401 }
  }

  const token = header.slice('Bearer '.length)
  const supabase = createSupabaseUserClient(header, options)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return { statusCode: 401 }
  }

  return { user }
}

function firstAuthorizationValue(
  authorization: string | readonly string[] | undefined,
): string | null {
  if (typeof authorization === 'string') {
    return authorization
  }

  if (authorization === undefined) {
    return null
  }

  const first = authorization[0]

  return typeof first === 'string' ? first : null
}

function readAuthUser(raw: string): ISupabaseAuthUser | null {
  try {
    const parsed: unknown = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as { readonly id?: unknown; readonly email?: unknown }
    const id = record.id

    if (typeof id !== 'string' || id.trim() === '') {
      return null
    }

    const email = record.email

    return {
      id,
      email: typeof email === 'string' && email.trim() !== '' ? email : null,
    }
  } catch {
    return null
  }
}
