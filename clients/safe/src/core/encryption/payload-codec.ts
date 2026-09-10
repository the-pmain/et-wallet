import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { InvalidArgumentError, VaultCorruptedError } from '@/core/errors'

import { CIPHER_ALGORITHM, KDF_ALGORITHM, type IEncryptedPayload, type IKdfParams } from './types'

/**
 * Portable representation of an encrypted container.
 *
 * Binary fields are hex strings. Same reason as the network records:
 * requiring `Uint8Array` from every storage backend would narrow the
 * choice. `chrome.storage` serialises through JSON, where typed arrays
 * become objects with numeric keys and silently corrupt.
 *
 * Hex doubles the size. For a key vault measured in kilobytes that
 * does not matter; correctness does.
 */
export interface IEncryptedPayloadRecord {
  readonly version: number
  readonly cipher: string
  readonly kdf: {
    readonly algorithm: string
    readonly iterations: number
    readonly salt: string
    readonly keyLength: number
    readonly memoryKib?: number
    readonly parallelism?: number
  }
  readonly iv: string
  readonly ciphertext: string
}

export function encodePayload(payload: IEncryptedPayload): IEncryptedPayloadRecord {
  return {
    version: payload.version,
    cipher: payload.cipher,
    kdf: {
      algorithm: payload.kdf.algorithm,
      iterations: payload.kdf.iterations,
      salt: bytesToHex(payload.kdf.salt),
      keyLength: payload.kdf.keyLength,
      ...(payload.kdf.memoryKib === undefined ? {} : { memoryKib: payload.kdf.memoryKib }),
      ...(payload.kdf.parallelism === undefined ? {} : { parallelism: payload.kdf.parallelism }),
    },
    iv: bytesToHex(payload.iv),
    ciphertext: bytesToHex(payload.ciphertext),
  }
}

/**
 * Restores a container from the portable form.
 *
 * Data from storage is UNTRUSTED: it may have been written by another
 * app version, corrupted by a failed write, or altered by other code.
 * The whole structure is checked, not just field presence.
 *
 * Tampering with the parameters themselves is detected later, at
 * decrypt: the header is part of AES-GCM additional authenticated data.
 *
 * @throws VaultCorruptedError if the structure is invalid.
 */
export function decodePayload(record: unknown): IEncryptedPayload {
  if (typeof record !== 'object' || record === null) {
    throw new VaultCorruptedError('the container is not an object')
  }

  const candidate = record as Partial<IEncryptedPayloadRecord>

  if (typeof candidate.version !== 'number') {
    throw new VaultCorruptedError('the format version is missing')
  }

  if (candidate.cipher !== CIPHER_ALGORITHM.AesGcm) {
    throw new VaultCorruptedError(`unknown cipher "${String(candidate.cipher)}"`)
  }

  if (typeof candidate.iv !== 'string' || typeof candidate.ciphertext !== 'string') {
    throw new VaultCorruptedError('the initialisation vector or the ciphertext is missing')
  }

  return {
    version: candidate.version,
    cipher: CIPHER_ALGORITHM.AesGcm,
    kdf: decodeKdfParams(candidate.kdf),
    iv: safeHexToBytes(candidate.iv, 'iv'),
    ciphertext: safeHexToBytes(candidate.ciphertext, 'ciphertext'),
  }
}

function decodeKdfParams(kdf: IEncryptedPayloadRecord['kdf'] | undefined): IKdfParams {
  if (typeof kdf !== 'object') {
    throw new VaultCorruptedError('the key derivation parameters are missing')
  }

  if (kdf.algorithm !== KDF_ALGORITHM.Pbkdf2 && kdf.algorithm !== KDF_ALGORITHM.Argon2id) {
    throw new VaultCorruptedError(`unknown key derivation algorithm "${String(kdf.algorithm)}"`)
  }

  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations <= 0) {
    throw new VaultCorruptedError('the iteration count is invalid')
  }

  if (!Number.isSafeInteger(kdf.keyLength) || kdf.keyLength <= 0) {
    throw new VaultCorruptedError('the key length is invalid')
  }

  return {
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    salt: safeHexToBytes(kdf.salt, 'salt'),
    keyLength: kdf.keyLength,
    ...(kdf.memoryKib === undefined ? {} : { memoryKib: kdf.memoryKib }),
    ...(kdf.parallelism === undefined ? {} : { parallelism: kdf.parallelism }),
  }
}

function safeHexToBytes(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0) {
    throw new VaultCorruptedError(`the field "${field}" is not a hexadecimal string`)
  }

  try {
    return hexToBytes(value)
  } catch (error) {
    throw new VaultCorruptedError(`the field "${field}" contains characters that are not allowed`, {
      cause: error,
    })
  }
}

/**
 * Builds additional authenticated data (AAD) for AES-GCM.
 *
 * WHY. The container header — format version, cipher, KDF parameters —
 * sits next to the ciphertext in the clear. Putting it in AAD means the
 * authentication tag covers the header too: any parameter change makes
 * decrypt fail.
 *
 * Without this the header is unsigned. That gives an attacker no direct
 * win today (changed parameters yield a different key, so decrypt fails),
 * but a second KDF algorithm would open a downgrade: swap `algorithm`
 * for a weaker one. AAD closes that class in advance and costs a few
 * lines.
 *
 * The string is built by hand, not via `JSON.stringify`: object key
 * order is not guaranteed, and AAD must match byte-for-byte on encrypt
 * and decrypt.
 */
export function buildAdditionalData(
  payload: Omit<IEncryptedPayload, 'ciphertext' | 'iv'>,
): Uint8Array {
  const parts = [
    `v=${String(payload.version)}`,
    `cipher=${payload.cipher}`,
    `kdf=${payload.kdf.algorithm}`,
    `iterations=${String(payload.kdf.iterations)}`,
    `keyLength=${String(payload.kdf.keyLength)}`,
    `salt=${bytesToHex(payload.kdf.salt)}`,
  ]

  return utf8ToBytes(parts.join('|'))
}

/** Rejects a non-positive byte count. Guards degenerate calls. */
export function assertPositiveLength(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidArgumentError(name, 'a positive integer is expected')
  }
}
