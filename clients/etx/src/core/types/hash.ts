import { InvalidArgumentError } from '@/core/errors'

import type { BlockHash, TxHash } from './primitives'

/** Хэш длиной 32 байта: `0x` и 64 шестнадцатеричных символа. */
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

/**
 * Создаёт хэш транзакции с проверкой формата.
 *
 * Единственный допустимый способ получить значение типа `TxHash`.
 *
 * Проверка не формальность: значение приходит из ответа узла, то есть
 * из недоверенного источника. Хэш, принятый без проверки, попадёт
 * в историю операций и в ссылку на обозреватель блоков, где приведёт
 * либо к пустой странице, либо к чужой транзакции.
 *
 * Приводится к нижнему регистру: узлы и обозреватели возвращают хэши
 * по-разному, а сравнение без нормализации не найдёт уже известную
 * транзакцию в истории.
 *
 * @throws InvalidArgumentError
 */
export function toTxHash(value: unknown): TxHash {
  return normalizeHash(value, 'txHash') as TxHash
}

/**
 * Создаёт хэш блока с проверкой формата.
 *
 * @throws InvalidArgumentError
 */
export function toBlockHash(value: unknown): BlockHash {
  return normalizeHash(value, 'blockHash') as BlockHash
}

function normalizeHash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new InvalidArgumentError(
      name,
      `expected 32 bytes in hexadecimal form, received "${String(value)}"`,
    )
  }

  return value.toLowerCase()
}
