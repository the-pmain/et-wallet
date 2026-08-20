/**
 * Сверяет адрес с колонкой `email`.
 *
 * Регистр и крайние пробелы не различают входы: `James@Mail.com`
 * и `james@mail.com` — одна запись. Пустое значение ни с чем
 * не совпадает — войти без почты нельзя.
 */
export function emailsMatch(stored: string | null | undefined, candidate: string): boolean {
  if (stored === null || stored === undefined) {
    return false
  }

  return normalizeEmail(stored) === normalizeEmail(candidate)
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}
