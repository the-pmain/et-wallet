import { InvalidArgumentError } from '@/core/errors'

import type { ChainId } from './primitives'

/**
 * Upper bound of a network identifier.
 *
 * EIP-155 does not set a limit explicitly, but EIP-2294 caps chainId
 * at 2^53-1 for JSON compatibility. That bound is used here: a larger
 * identifier will not be handled correctly by any node or any block
 * explorer.
 */
export const MAX_CHAIN_ID = 2n ** 53n - 1n

/**
 * Creates a network identifier after checking the range.
 *
 * The only allowed way to obtain a `ChainId`. A type assertion
 * (`as ChainId`) bypasses the check and is forbidden: an unchecked
 * identifier goes into the signed transaction data per EIP-155, and
 * an error in it means a signature for the wrong network.
 *
 * @throws InvalidArgumentError if the value is not a positive integer
 *         in the allowed range.
 */
export function toChainId(value: bigint | number | string): ChainId {
  let parsed: bigint

  try {
    parsed = BigInt(value)
  } catch {
    throw new InvalidArgumentError('chainId', `the value "${String(value)}" is not a number`)
  }

  if (parsed <= 0n) {
    throw new InvalidArgumentError('chainId', 'the chain identifier must be positive')
  }

  if (parsed > MAX_CHAIN_ID) {
    throw new InvalidArgumentError(
      'chainId',
      `the identifier exceeds the maximum ${MAX_CHAIN_ID.toString()}`,
    )
  }

  return parsed as ChainId
}

/**
 * Parses a network identifier from a hex JSON-RPC response.
 *
 * `eth_chainId` returns a string like `0x1`. Parsing is a separate
 * function because it runs in node-authenticity checks, where the
 * response comes from an untrusted source.
 *
 * @throws InvalidArgumentError if the string is not a hex number.
 */
export function parseChainIdFromHex(value: unknown): ChainId {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new InvalidArgumentError(
      'chainId',
      `the node response "${String(value)}" is not a hexadecimal number`,
    )
  }

  return toChainId(value)
}

/**
 * Converts a network identifier to hex.
 *
 * Needed for dApp interaction: EIP-1193 and EIP-3085 pass chainId as
 * a string like `0x89`, not a decimal number.
 */
export function chainIdToHex(chainId: ChainId): string {
  return `0x${chainId.toString(16)}`
}
