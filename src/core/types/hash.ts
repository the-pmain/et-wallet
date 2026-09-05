import { InvalidArgumentError } from '@/core/errors'

import type { BlockHash, TxHash } from './primitives'

/** 32-byte hash: `0x` and 64 hex characters. */
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

/**
 * Creates a transaction hash after checking the format.
 *
 * The only allowed way to obtain a `TxHash`.
 *
 * The check is not a formality: the value comes from a node
 * response, i.e. an untrusted source. A hash accepted without a
 * check ends up in history and in a block-explorer link, where it
 * leads either to a blank page or to someone else's transaction.
 *
 * Forced to lower case: nodes and explorers return hashes
 * differently, and a comparison without normalisation will not find
 * an already-known transaction in history.
 *
 * @throws InvalidArgumentError
 */
export function toTxHash(value: unknown): TxHash {
  return normalizeHash(value, 'txHash') as TxHash
}

/**
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
