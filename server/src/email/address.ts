/**
 * Проверка адреса для поля From/To.
 *
 * Это не полная проверка RFC 5322: она отвергает пустое значение,
 * пробелы и отсутствие точки в домене. Дальше Cloudflare сам
 * отвергнет адрес, с которого домен не подключён к Email Sending.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const EMAIL_MAX = 254

export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim()

  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX) {
    return false
  }

  return EMAIL_SHAPE.test(trimmed)
}
