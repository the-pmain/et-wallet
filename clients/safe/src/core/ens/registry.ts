import { WORD_LENGTH, readAddressWord, strip } from '@/core/abi'
import { toAddress } from '@/core/address'
import { functionSelector } from '@/core/token'
import { toChainId, type Address, type ChainId, type HexString } from '@/core/types'

/**
 * Network the ENS registry lives on.
 *
 * ENS is deployed on Ethereum. A name resolved here is valid on
 * other networks too — the EVM address space is shared — but the
 * registry itself exists in one instance and on one chain.
 */
export const ENS_CHAIN_ID: ChainId = toChainId(1)

/**
 * ENS registry address.
 *
 * WRITTEN IN LOWERCASE AND RUN THROUGH `toAddress` ON PURPOSE.
 * The EIP-55 checksum is computed, not copied: forty characters
 * pasted from memory together with their case are unverifiable
 * when reading, and a case error would make `toAddress` fail
 * instead of a working wallet.
 *
 * THE VALUE ITSELF WAS CHECKED WITH A LIVE CALL, not taken from
 * memory: `resolver(namehash('vitalik.eth'))` at this address
 * returns a live resolver, and that resolver returns an address
 * whose reverse lookup yields the same name. A wrong registry
 * address would give zeros on the first step.
 * `EnsService.test.ts` repeats this chain on a test double.
 */
export const ENS_REGISTRY_ADDRESS: Address = toAddress('0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e')

export const ENS_RESOLVER_SELECTOR = functionSelector('resolver(bytes32)')

export const ENS_ADDR_SELECTOR = functionSelector('addr(bytes32)')

export const ENS_NAME_SELECTOR = functionSelector('name(bytes32)')

export function encodeNodeCall(selector: string, node: HexString): HexString {
  return `0x${selector}${node.slice(2)}` as HexString
}

/**
 * Reads an address from a contract response.
 *
 * A ZERO ADDRESS IS RETURNED AS `null`, AND THAT IS THE POINT
 * OF THIS FUNCTION. The registry answers with zero for any
 * unregistered node, and the resolver — for a missing record.
 * Taking that zero as the recipient would send funds to the
 * burn address, from which nobody can recover them. Absence
 * of a record and an address are different claims.
 *
 * @returns The address, or `null` if the response is empty, zero, or shorter than a word.
 */
export function decodeAddressWord(data: HexString): Address | null {
  const body = strip(data)

  if (body.length < WORD_LENGTH) {
    return null
  }

  /* Alignment is checked by the shared parser: a word with non-zero
     high bytes is not an address. This used to be a local expression
     here — a third copy of the same rule. */
  const address = readAddressWord(body.slice(0, WORD_LENGTH))

  if (address === null) {
    return null
  }

  const hex = address.toLowerCase()

  if (/^0x0{40}$/.test(hex)) {
    return null
  }

  return toAddress(hex)
}

/**
 * Reads a string from a contract response.
 *
 * ABI format for `string`: offset, length, contents. Parsing is
 * deliberately strict — the response comes from a contract we did
 * not write, and any mismatch means "could not read", not "no name".
 *
 * @returns The string, or `null` if the response is empty or cannot be parsed.
 */
export function decodeStringResult(data: HexString): string | null {
  const body = data.startsWith('0x') ? data.slice(2) : data

  if (body.length < WORD_LENGTH * 2) {
    return null
  }

  const offset = Number(BigInt(`0x${body.slice(0, WORD_LENGTH)}`)) * 2
  const lengthStart = offset

  if (!Number.isSafeInteger(offset) || body.length < lengthStart + WORD_LENGTH) {
    return null
  }

  const length = Number(BigInt(`0x${body.slice(lengthStart, lengthStart + WORD_LENGTH)}`)) * 2
  const contentStart = lengthStart + WORD_LENGTH

  if (!Number.isSafeInteger(length) || body.length < contentStart + length) {
    return null
  }

  if (length === 0) {
    return null
  }

  const bytes = new Uint8Array(length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      body.slice(contentStart + index * 2, contentStart + index * 2 + 2),
      16,
    )
  }

  /* `fatal: true` — an invalid UTF-8 sequence fails instead of
     becoming replacement characters. A name that is not text
     must not be shown: that is how strings are forged on screen. */
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
