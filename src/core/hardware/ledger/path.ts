import { HARDENED_OFFSET } from '@/core/hdwallet'
import type { DerivationPath } from '@/core/types'

import { HardwareDeviceError } from './errors'

/**
 * Greatest number of path levels.
 *
 * A device limit: path length is sent as one byte, and the path
 * itself takes four bytes per level and must fit in the command
 * together with the rest of the data. Ten levels cover every
 * standard with room to spare: BIP-44 uses five.
 */
const MAX_DEPTH = 10

/** Greatest level value without the hardened flag. */
const MAX_INDEX = HARDENED_OFFSET - 1

/**
 * Encodes a derivation path in the form the device understands.
 *
 * FORMAT. One byte for the number of levels, then each level as four
 * big-endian bytes. A hardened level is marked by the high bit set —
 * the same flag as in BIP-32.
 *
 * PARSING IS STRICT. The path decides which key the device will sign
 * with. An error here means a signature with the wrong key, i.e.
 * sending from the wrong address, and it will only be noticed on
 * chain. Therefore any deviation is a refusal, not an attempt to
 * guess.
 */
export function encodeDerivationPath(path: DerivationPath): Uint8Array {
  const levels = parseLevels(path)
  const encoded = new Uint8Array(1 + levels.length * 4)

  encoded[0] = levels.length

  levels.forEach((level, index) => {
    const offset = 1 + index * 4

    encoded[offset] = (level >>> 24) & 0xff
    encoded[offset + 1] = (level >>> 16) & 0xff
    encoded[offset + 2] = (level >>> 8) & 0xff
    encoded[offset + 3] = level & 0xff
  })

  return encoded
}

function parseLevels(path: DerivationPath): readonly number[] {
  const parts = path.split('/')

  if (parts[0] !== 'm') {
    throw new HardwareDeviceError(`the derivation path must start with "m": ${path}`)
  }

  const levels = parts.slice(1)

  if (levels.length === 0 || levels.length > MAX_DEPTH) {
    throw new HardwareDeviceError(`the derivation path has an unsupported depth: ${path}`)
  }

  return levels.map((level) => parseLevel(level, path))
}

function parseLevel(level: string, path: DerivationPath): number {
  const isHardened = level.endsWith("'") || level.endsWith('h')
  const digits = isHardened ? level.slice(0, -1) : level

  /* Check as a string, not via `Number`: that accepts hex, signs,
     and spaces, and "0x10" would become the sixteenth account
     instead of a refusal. */
  if (!/^\d+$/u.test(digits)) {
    throw new HardwareDeviceError(`the derivation path contains a malformed level: ${path}`)
  }

  const index = Number(digits)

  if (index > MAX_INDEX) {
    throw new HardwareDeviceError(`the derivation path contains a level out of range: ${path}`)
  }

  return isHardened ? index + HARDENED_OFFSET : index
}
