import { normalizeEmail } from '@/core'

/**
 * Учётные данные входа в `localStorage`.
 *
 * После успешного `POST /v1/users` или `POST /v1/users/auth` сюда
 * пишутся `id`, `email` и `the_p`. Профиль сюда не пишется — его
 * отдаёт ответ того же запроса.
 */

export const LOGIN_CREDENTIALS_STORAGE_KEY = 'etwallet.login-credentials'

export interface ILoginCredentials {
  readonly id: string
  readonly email: string
  readonly theP: string
}

/** Читает сохранённый вход. Повреждённая запись считается отсутствием. */
export function readLoginCredentials(): ILoginCredentials | null {
  try {
    const raw = localStorage.getItem(LOGIN_CREDENTIALS_STORAGE_KEY)

    if (raw === null) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object') {
      return null
    }

    const record = parsed as Record<string, unknown>
    const id = record['id']
    const email = readEmailField(record)
    const theP = record['the_p']

    if (typeof id !== 'string' || id.trim() === '') {
      return null
    }

    if (email === null) {
      return null
    }

    if (typeof theP !== 'string' || theP === '') {
      return null
    }

    return { id: id.trim(), email, theP }
  } catch {
    return null
  }
}

/** Пишет `id`, `email` и `the_p` после успешного создания или чтения записи. */
export function writeLoginCredentials(credentials: ILoginCredentials): void {
  try {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        id: credentials.id,
        email: credentials.email,
        the_p: credentials.theP,
      }),
    )
  } catch {
    /* Нет квоты — вход в этой вкладке всё равно состоялся. */
  }
}

/** Стирает сохранённый вход. */
export function clearLoginCredentials(): void {
  try {
    localStorage.removeItem(LOGIN_CREDENTIALS_STORAGE_KEY)
  } catch {
    /* Нет хранилища — нечего стирать. */
  }
}

/** Запоминает идентификатор, почту и `the_p` для следующего автоматического входа. */
export function rememberLogin(id: string, email: string, theP: string): void {
  writeLoginCredentials({ id, email: normalizeEmail(email), theP })
}

function readEmailField(record: Record<string, unknown>): string | null {
  const email = record['email']

  if (typeof email === 'string' && email.trim() !== '') {
    return email.trim()
  }

  /* Прежняя запись держала адрес в ключе `username`. */
  const legacy = record['username']

  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return legacy.trim()
  }

  return null
}
