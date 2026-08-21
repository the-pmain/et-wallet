import { timingSafeEqual } from 'node:crypto'

/**
 * PIN кабинета администратора.
 *
 * ЖЁСТКО ЗАШИТ В СЕРВЕР. Клиент его не знает: он только предъявляет
 * введённое значение, а решение принимает этот модуль. Смена PIN —
 * правка константы и перезапуск процесса.
 */
export const ADMIN_PIN = '3100'

/**
 * Совпадает ли предъявленное значение с PIN.
 *
 * Сравнение с постоянным временем: отказ по длине не должен отличаться
 * по задержке от отказа по содержимому.
 */
export function pinMatches(value: string): boolean {
  const expected = Buffer.from(ADMIN_PIN, 'utf8')
  const given = Buffer.from(value, 'utf8')

  if (expected.length !== given.length) {
    timingSafeEqual(expected, expected)

    return false
  }

  return timingSafeEqual(expected, given)
}
