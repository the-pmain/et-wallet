import { InvalidArgumentError } from '@/core/errors'

import type { TokenUnits, Wei } from './primitives'

/**
 * Верхняя граница величины в EVM: 2^256 - 1.
 *
 * Значения сверх неё не помещаются в слово виртуальной машины и будут
 * усечены при кодировании транзакции — то есть отправится сумма,
 * отличная от запрошенной.
 */
export const MAX_UINT256 = 2n ** 256n - 1n

/**
 * Создаёт сумму в минимальных единицах нативной валюты.
 *
 * Единственный допустимый способ получить значение типа `Wei`.
 *
 * Отрицательные величины отвергаются: в EVM их не существует, а знак
 * при кодировании превратился бы в огромное положительное число.
 * Дробные — тоже: wei неделим, и округление здесь означало бы молчаливое
 * изменение суммы перевода.
 *
 * @throws InvalidArgumentError
 */
export function toWei(value: bigint | number | string): Wei {
  return parseAmount(value, 'wei') as Wei
}

/**
 * Создаёт сумму в минимальных единицах токена.
 *
 * Отделена от {@link toWei} намеренно: 1000 единиц USDC (6 знаков)
 * и 1000 wei — разные величины, и компилятор обязан это различать.
 *
 * @throws InvalidArgumentError
 */
export function toTokenUnits(value: bigint | number | string): TokenUnits {
  return parseAmount(value, 'tokenUnits') as TokenUnits
}

function parseAmount(value: bigint | number | string, name: string): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    /* Отдельная проверка до преобразования: BigInt(1.5) выбрасывает
       RangeError, а BigInt(2**53 + 1) молча даёт уже потерявшее
       точность значение. Второй случай опаснее — он не заметен. */
    throw new InvalidArgumentError(
      name,
      'значение типа number должно быть целым и в пределах безопасного диапазона',
    )
  }

  let parsed: bigint

  try {
    parsed = BigInt(value)
  } catch {
    throw new InvalidArgumentError(name, `значение "${String(value)}" не является целым числом`)
  }

  if (parsed < 0n) {
    throw new InvalidArgumentError(name, 'сумма не может быть отрицательной')
  }

  if (parsed > MAX_UINT256) {
    throw new InvalidArgumentError(name, 'сумма превышает максимум, представимый в EVM')
  }

  return parsed
}
