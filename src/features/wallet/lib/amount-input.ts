/**
 * Переводит введённую пользователем сумму в минимальные единицы.
 *
 * РАЗБОР ВЫПОЛНЯЕТСЯ НА СТРОКАХ, БЕЗ ЧИСЕЛ С ПЛАВАЮЩЕЙ ТОЧКОЙ.
 * `Number('0.1') * 1e18` даёт 100000000000000001 — на единицу больше
 * запрошенного. Для денег такая погрешность недопустима: пользователь
 * подтвердил бы одну сумму, а подписал другую.
 *
 * Дробная часть длиннее числа знаков токена отвергается, а не
 * округляется: молчаливое отбрасывание разрядов означало бы отправку
 * суммы, отличной от введённой.
 *
 * @throws Error с понятной причиной при недопустимой записи.
 */
export function parseAmount(input: string, decimals: number): bigint {
  const value = input.trim().replace(',', '.')

  if (value === '') {
    throw new Error('Введите сумму')
  }

  if (!/^\d*\.?\d*$/u.test(value)) {
    throw new Error('Сумма записывается цифрами, разделитель — точка либо запятая')
  }

  const [whole = '', fraction = ''] = value.split('.')

  if (fraction.length > decimals) {
    throw new Error(`Слишком много знаков после запятой: допустимо ${String(decimals)}`)
  }

  const normalized = `${whole === '' ? '0' : whole}${fraction.padEnd(decimals, '0')}`
  const parsed = BigInt(normalized)

  if (parsed <= 0n) {
    throw new Error('Сумма должна быть больше нуля')
  }

  return parsed
}
