import { InvalidArgumentError } from '@/core/errors'

import type { ChainId } from './primitives'

/**
 * Верхняя граница идентификатора сети.
 *
 * EIP-155 не задаёт предела явно, но EIP-2294 ограничивает chainId
 * значением 2^53-1 для совместимости с JSON. Берём именно эту границу:
 * идентификатор больше неё не будет корректно обработан ни одним узлом
 * и ни одним обозревателем блоков.
 */
export const MAX_CHAIN_ID = 2n ** 53n - 1n

/**
 * Создаёт идентификатор сети с проверкой диапазона.
 *
 * Единственный допустимый способ получить значение типа `ChainId`.
 * Приведение типом (`as ChainId`) обходит проверку и запрещено:
 * непроверенный идентификатор попадает в подписываемые данные транзакции
 * по EIP-155, и ошибка в нём означает подпись для чужой сети.
 *
 * @throws InvalidArgumentError если значение не положительное целое
 *         в допустимом диапазоне.
 */
export function toChainId(value: bigint | number | string): ChainId {
  let parsed: bigint

  try {
    parsed = BigInt(value)
  } catch {
    throw new InvalidArgumentError('chainId', `значение "${String(value)}" не является числом`)
  }

  if (parsed <= 0n) {
    throw new InvalidArgumentError('chainId', 'идентификатор сети должен быть положительным')
  }

  if (parsed > MAX_CHAIN_ID) {
    throw new InvalidArgumentError(
      'chainId',
      `идентификатор превышает максимум ${MAX_CHAIN_ID.toString()}`,
    )
  }

  return parsed as ChainId
}

/**
 * Разбирает идентификатор сети из шестнадцатеричного ответа JSON-RPC.
 *
 * Метод `eth_chainId` возвращает строку вида `0x1`. Разбор вынесен
 * в отдельную функцию, потому что выполняется в проверке подлинности узла,
 * где ответ приходит из недоверенного источника.
 *
 * @throws InvalidArgumentError если строка не является hex-числом.
 */
export function parseChainIdFromHex(value: unknown): ChainId {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new InvalidArgumentError(
      'chainId',
      `ответ узла "${String(value)}" не является hex-числом`,
    )
  }

  return toChainId(value)
}

/**
 * Преобразует идентификатор сети в шестнадцатеричный вид.
 *
 * Требуется для взаимодействия с dApp: EIP-1193 и EIP-3085 передают
 * chainId строкой вида `0x89`, а не десятичным числом.
 */
export function chainIdToHex(chainId: ChainId): string {
  return `0x${chainId.toString(16)}`
}
