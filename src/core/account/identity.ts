import { bytesToHex } from '@noble/hashes/utils.js'

import { getRandomBytes } from '@/core/encryption'
import { InvalidArgumentError } from '@/core/errors'
import type { KeyringType } from '@/core/keyring'
import type { AccountId, KeyringId } from '@/core/types'

const ACCOUNT_ID_LENGTH = 16
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/

export const MIN_ACCOUNT_NAME_LENGTH = 1

/**
 * Maximum account name length.
 *
 * This is an interface limit, not a storage one: a long name pushes the
 * address off the confirmation row, so the owner sees a label instead of
 * where the funds go. They chose the name themselves — a name from an
 * imported backup did not.
 */
export const MAX_ACCOUNT_NAME_LENGTH = 64

/**
 * Identifier of the single key set derived from the seed phrase.
 *
 * Fixed on purpose: the wallet has one HD tree, and a second identifier
 * for it would be a spare entity. Imported keys get their own ids.
 */
export const HD_KEYRING_ID = 'hd' as KeyringId

/**
 * Identifier of a hardware-wallet key set.
 *
 * One per device type, not per unit: two devices with the same seed hold
 * the same keys, and distinguishing them would be a distinction without
 * a difference.
 */
export function hardwareKeyringId(type: KeyringType): KeyringId {
  return type as KeyringId
}

/**
 * Creates a new account identifier.
 *
 * Random, not derived from the address, on purpose: the same address can
 * be added again from another source — first as watch-only, then from a
 * hardware wallet. Tying the id to the address would drop the owner's
 * name and settings on re-import.
 *
 * The same randomness source as for keys: a weaker generator "for
 * non-secrets" will eventually be used for a secret.
 */
export function createAccountId(): AccountId {
  return bytesToHex(getRandomBytes(ACCOUNT_ID_LENGTH)) as AccountId
}

/**
 * Checks an account identifier read from storage.
 *
 * @throws InvalidArgumentError
 */
export function toAccountId(value: string): AccountId {
  if (!ACCOUNT_ID_PATTERN.test(value)) {
    throw new InvalidArgumentError('accountId', `the value "${value}" is not an identifier`)
  }

  return value as AccountId
}

/**
 * Canonicalizes and checks an account name.
 *
 * Control characters are stripped: the name comes from the owner or from
 * an imported backup, and a newline or carriage return in the name breaks
 * the account list layout and can visually forge the neighbouring row.
 *
 * @throws InvalidArgumentError if the name is empty or too long.
 */
export function normalizeAccountName(value: string): string {
  const normalized = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length < MIN_ACCOUNT_NAME_LENGTH) {
    throw new InvalidArgumentError('name', 'the account name cannot be empty')
  }

  if (normalized.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new InvalidArgumentError(
      'name',
      `a name longer than ${String(MAX_ACCOUNT_NAME_LENGTH)} characters would push the address out of the confirmation screen`,
    )
  }

  return normalized
}

/** Default name for the account at the given order. */
export function defaultAccountName(order: number): string {
  return `Account ${String(order + 1)}`
}
