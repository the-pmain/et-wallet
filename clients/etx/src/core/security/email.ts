/**
 * Адрес почты как идентификатор входа.
 *
 * В таблице `public.users` он лежит в колонке `email`.
 * Пароль — `the_p`. Регистр не различает входы,
 * поэтому для хранения адрес приводится к нижнему.
 *
 * Проверка намеренно простая: нужен адрес, который человек узнает
 * как почту, а не полный RFC. Пустое значение и пробелы отвергаются.
 */

/** Наибольшая длина адреса по RFC 5321. */
export const MAX_EMAIL_LENGTH = 254

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/**
 * Приводит адрес к виду для хранения и сверки.
 *
 * Крайние пробелы снимаются, регистр — к нижнему: `James@Mail.com`
 * и `james@mail.com` — один вход.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Пригоден ли адрес как идентификатор входа. */
export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value)

  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    return false
  }

  return EMAIL_PATTERN.test(normalized)
}
