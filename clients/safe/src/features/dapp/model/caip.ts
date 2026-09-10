import { toChainId, type Address, type ChainId } from '@/core'

/**
 * Network and account identifiers per CAIP-2 and CAIP-10.
 *
 * WalletConnect addresses networks as `eip155:1` and accounts as
 * `eip155:1:0x…`. Internally the wallet uses `ChainId`, so the
 * conversion happens at the transport boundary in one place: two
 * copies of this parse would drift on the first edit.
 */

const EVM_NAMESPACE = 'eip155'

export function toCaip2(chainId: ChainId): string {
  return `${EVM_NAMESPACE}:${chainId.toString()}`
}

export function toCaip10(chainId: ChainId, address: Address): string {
  return `${toCaip2(chainId)}:${address}`
}

/**
 * Parse a network identifier.
 *
 * `null` for a foreign namespace or an unparseable string.
 * Substituting a default here would run a request on a network
 * the app did not ask for.
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
