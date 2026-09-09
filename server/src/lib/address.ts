import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * EVM address check and EIP-55 checksum.
 *
 * WHY A SERVICE THAT ONLY SERVES ADDRESSES NEEDS THIS. The catalog is
 * written by people, and a hex address is unchecked when you read it:
 * one wrong character is a different contract. EIP-55 catches that
 * typo when the catalog loads — before a wrong address reaches users'
 * wallets.
 *
 * Implementation uses keccak-256 from a reviewed library; there are
 * no homemade crypto primitives here.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u

/** Whether the string looks like an EVM address. */
export function hasAddressShape(value: string): boolean {
  return ADDRESS_PATTERN.test(value)
}

/**
 * Formats an address with an EIP-55 checksum.
 *
 * Letter case encodes the address hash: each letter is uppercased if
 * the matching hash nibble is at least eight.
 *
 * @throws Error if the string is not address-shaped.
 */
export function toChecksumAddress(value: string): string {
  if (!hasAddressShape(value)) {
    throw new Error(`The string is not an EVM address: ${value}`)
  }

  const body = value.slice(2).toLowerCase()
  const hash = bytesToHex(keccak_256(utf8ToBytes(body)))

  let result = '0x'

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? ''
    const hashDigit = hash[index] ?? '0'

    result += Number.parseInt(hashDigit, 16) >= 8 ? character.toUpperCase() : character
  }

  return result
}

/**
 * Whether the address carries a valid EIP-55 checksum.
 *
 * An address that is all-lowercase or all-uppercase has no checksum
 * and fails: in the catalog that would mean nobody checked the address.
 */
export function hasValidChecksum(value: string): boolean {
  return hasAddressShape(value) && toChecksumAddress(value) === value
}
