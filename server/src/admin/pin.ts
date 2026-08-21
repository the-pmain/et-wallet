import { timingSafeEqual } from 'node:crypto'

/**
 * PIN кабинета администратора (`/admin`).
 *
 * ЖЁСТКО ЗАШИТ В СЕРВЕР. Клиент его не знает: он только предъявляет
 * введённое значение, а решение принимает этот модуль.
 */
export const ADMIN_PIN = '9100'

/**
 * PIN менеджера писем (`/email-manager`).
 *
 * Отдельный код и отдельная сверка: кабинет пользователей и отправка
 * писем не делят один секрет.
 */
export const EMAIL_MANAGER_PIN = '3100'

/**
 * Совпадает ли предъявленное значение с PIN кабинета.
 *
 * Сравнение с постоянным временем: отказ по длине не должен отличаться
 * по задержке от отказа по содержимому.
 */
export function pinMatches(value: string): boolean {
  return constantTimeEquals(ADMIN_PIN, value)
}

/** Совпадает ли предъявленное значение с PIN менеджера писем. */
export function emailManagerPinMatches(value: string): boolean {
  return constantTimeEquals(EMAIL_MANAGER_PIN, value)
}

function constantTimeEquals(expectedUtf8: string, value: string): boolean {
  const expected = Buffer.from(expectedUtf8, 'utf8')
  const given = Buffer.from(value, 'utf8')

  if (expected.length !== given.length) {
    timingSafeEqual(expected, expected)

    return false
  }

  return timingSafeEqual(expected, given)
}
