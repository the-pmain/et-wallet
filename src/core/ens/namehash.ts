import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type { Address, HexString } from '@/core/types'

/** ENS node length in bytes. Fixed by EIP-137 and not configurable. */
const NODE_LENGTH = 32

/**
 * Suffix under which reverse records live.
 *
 * EIP-181: address `0xAbC…` has a reverse record at
 * `abc….addr.reverse`, with the address in LOWERCASE and without `0x`.
 * Writing it in EIP-55 checksum case would yield a different node
 * and therefore "no reverse record" for an address that has one.
 */
const REVERSE_SUFFIX = 'addr.reverse'

/**
 * Computes the ENS node for a name — the namehash algorithm from EIP-137.
 *
 * ```
 * namehash('')          = 0x00…00
 * namehash('a.b')       = keccak256(namehash('b') ‖ keccak256('a'))
 * ```
 *
 * WHY THIS IS IMPLEMENTED HERE, NOT TAKEN FROM A LIBRARY. This is not
 * cryptography, it is composition of a ready keccak256 from
 * `@noble/hashes`: no hash function of our own appears. The
 * implementation fits in a dozen lines and is checked against
 * reference values from the standard text, so a separate dependency
 * for it does not earn its weight.
 *
 * THE NAME MUST ALREADY BE NORMALIZED. The function hashes what it
 * received, byte for byte: `Vitalik.eth` and `vitalik.eth` yield
 * different nodes. Bringing the name to canonical form is
 * `normalizeEnsName`'s job, and namehash must not be called around it.
 */
export function namehash(name: string): HexString {
  let node = new Uint8Array(NODE_LENGTH)

  if (name !== '') {
    /* Labels are walked right to left: the node is built from the root down. */
    for (const label of name.split('.').reverse()) {
      const joined = new Uint8Array(NODE_LENGTH * 2)

      joined.set(node, 0)
      joined.set(keccak_256(utf8ToBytes(label)), NODE_LENGTH)

      node = keccak_256(joined)
    }
  }

  return `0x${bytesToHex(node)}` as HexString
}

/**
 * Reverse-record node for an address.
 *
 * @param address Address in any case. Lowercased per EIP-181.
 */
export function reverseNode(address: Address): HexString {
  return namehash(`${address.slice(2).toLowerCase()}.${REVERSE_SUFFIX}`)
}
