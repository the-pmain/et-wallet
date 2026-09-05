import { UnauthorizedError } from '../lib/errors.ts'

/**
 * Supabase clients for `public.users` only.
 *
 * User-scoped client: `SUPABASE_URL` + publishable/anon and the
 * current request `Authorization` header. The service-role key is
 * not included.
 *
 * Admin client: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Only after
 * a server check (`email`+`the_p` or `x-admin-pin`). Do not pick by
 * a body field such as `{ "role": "admin" }`.
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

/** Publishable, else anon. Service-role is never substituted here. */
export function readSupabasePublishableKey(
  publishableKey: string | null,
  anonKey: string | null,
): string | null {
  return publishableKey ?? anonKey
}

/**
 * Full `Authorization: Bearer …` of the current request.
 *
 * `null` — no header, or it is not Bearer.
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
    throw new UnauthorizedError('Invalid credentials.')
  }

  return header
}

/**
 * User-scoped client: publishable/anon + request JWT.
 *
 * Does not use `SUPABASE_SERVICE_ROLE_KEY`.
 */
export function createSupabaseUserClient(
  authorizationHeader: string,
  options: ISupabaseUserClientOptions,
): ISupabaseUserClient {
  const header = readBearerAuthorization(authorizationHeader)

  if (header === null) {
    throw new UnauthorizedError('Invalid credentials.')
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
 * Trusted server client.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Only after Node
 * authorization. Not for "so we do not have to write policies".
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
 * Checks Bearer with Supabase Auth. Missing or expired — 401.
 *
 * For routes whose identity comes from a JWT. Existing `/v1/users`
 * check `email` and `the_p`, not this header.
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
