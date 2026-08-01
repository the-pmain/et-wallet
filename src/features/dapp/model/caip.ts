import { toChainId, type Address, type ChainId } from '@/core'

/**
 * Идентификаторы сетей и счетов по CAIP-2 и CAIP-10.
 *
 * WalletConnect адресует сети строкой вида `eip155:1`, а счета —
 * `eip155:1:0x…`. Кошелёк внутри работает с `ChainId`, поэтому перевод
 * выполняется на границе транспорта и в одном месте: две копии этого
 * разбора разошлись бы при первой же правке.
 */

/** Пространство имён сетей EVM. */
const EVM_NAMESPACE = 'eip155'

/** Строит идентификатор сети: `eip155:1`. */
export function toCaip2(chainId: ChainId): string {
  return `${EVM_NAMESPACE}:${chainId.toString()}`
}

/** Строит идентификатор счёта: `eip155:1:0x…`. */
export function toCaip10(chainId: ChainId, address: Address): string {
  return `${toCaip2(chainId)}:${address}`
}

/**
 * Читает идентификатор сети.
 *
 * `null` для чужого пространства имён либо неразбираемой строки.
 * Подставить сюда значение по умолчанию значило бы выполнить запрос
 * не в той сети, о которой просило приложение.
 */
export function parseCaip2(value: string): ChainId | null {
  const [namespace, reference] = value.split(':')

  if (namespace !== EVM_NAMESPACE || reference === undefined) {
    return null
  }

  if (!/^\d+$/u.test(reference)) {
    return null
  }

  try {
    return toChainId(BigInt(reference))
  } catch {
    return null
  }
}
