import { InvalidArgumentError } from '@/core/errors'

import type { TokenUnits, Wei } from './primitives'

/**
 * Upper bound of a magnitude in the EVM: 2^256 - 1.
 *
 * Values beyond it do not fit in a VM word and will be truncated
 * when the transaction is encoded — i.e. an amount different from
 * the one requested will be sent.
 */
export const MAX_UINT256 = 2n ** 256n - 1n

/**
 * Creates an amount in the native currency's smallest units.
 *
 * The only allowed way to obtain a `Wei`.
 *
 * Negative values are rejected: they do not exist in the EVM, and
 * the sign would become a huge positive number on encode. Fractions
 * too: wei is indivisible, and rounding here would silently change
 * the transfer amount.
 *
 * @throws InvalidArgumentError
 */
export function toWei(value: bigint | number | string): Wei {
  return parseAmount(value, 'wei') as Wei
}

/**
 * Creates an amount in a token's smallest units.
 *
 * Separated from {@link toWei} on purpose: 1000 units of USDC (6
 * decimals) and 1000 wei are different quantities, and the compiler
 * must tell them apart.
 *
 * @throws InvalidArgumentError
 */
export function toTokenUnits(value: bigint | number | string): TokenUnits {
  return parseAmount(value, 'tokenUnits') as TokenUnits
}

function parseAmount(value: bigint | number | string, name: string): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    /* Separate check before conversion: BigInt(1.5) throws
       RangeError, while BigInt(2**53 + 1) silently yields an
       already-imprecise value. The second case is more dangerous —
       it is not visible. */
    throw new InvalidArgumentError(name, 'a number value must be an integer within the safe range')
  }

  let parsed: bigint

  try {
    parsed = BigInt(value)
  } catch {
    throw new InvalidArgumentError(name, `the value "${String(value)}" is not an integer`)
  }

  if (parsed < 0n) {
    throw new InvalidArgumentError(name, 'the amount cannot be negative')
  }

  if (parsed > MAX_UINT256) {
    throw new InvalidArgumentError(name, 'the amount exceeds the maximum representable in the EVM')
  }

  return parsed
}
