import {
  DecryptionFailedError,
  InvalidArgumentError,
  RandomnessUnavailableError,
  UnsupportedVaultVersionError,
} from '@/core/errors'

import type { IEncryptionService } from './contracts'
import { EncryptionKey } from './EncryptionKey'
import {
  AES_GCM,
  AUTH_TAG_BITS,
  IV_LENGTH,
  PAYLOAD_VERSION,
  PBKDF2,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  createDefaultKdfParams,
} from './parameters'
import { buildAdditionalData } from './payload-codec'
import { getRandomBytes, wipeBytes } from './random'
import { SecretBuffer } from './SecretBuffer'
import {
  CIPHER_ALGORITHM,
  KDF_ALGORITHM,
  type IEncryptedPayload,
  type IKdfParams,
  type ISecretBuffer,
} from './types'

/**
 * Encryption on top of the Web Crypto API.
 *
 * WHAT IS NOT IMPLEMENTED HERE AND WILL NOT BE: AES, GCM, PBKDF2, or
 * the RNG. The browser does all of that in native code. A homemade
 * primitive would be worse: slower, timing-vulnerable, and unaudited.
 *
 * WHY THE PASSWORD IS A STRING. It comes from an input field, and a
 * browser input value is a string. Encoding it to a buffer is possible,
 * but the original string stays on the heap unwipeable — as it does
 * inside the field itself and in the DOM event history. Pretending the
 * password is safe from a memory dump would be a lie; the real
 * protection here is KDF cost and a short unlocked session.
 */
export class EncryptionService implements IEncryptionService {
  async encrypt(plaintext: Uint8Array, password: string): Promise<IEncryptedPayload> {
    const params = this.createKdfParams()
    const key = await this.deriveKey(password, params)

    try {
      return await this.encryptWithKey(plaintext, key, params)
    } finally {
      key.destroy()
    }
  }

  async decrypt(payload: IEncryptedPayload, password: string): Promise<ISecretBuffer> {
    EncryptionService.#assertSupportedVersion(payload)

    const key = await this.deriveKey(password, payload.kdf)

    try {
      return await this.decryptWithKey(payload, key)
    } finally {
      key.destroy()
    }
  }

  async verifyPassword(payload: IEncryptedPayload, password: string): Promise<boolean> {
    try {
      const decrypted = await this.decrypt(payload, password)
      decrypted.wipe()

      return true
    } catch {
      /* Distinguishing "wrong password" from "data corrupted" is
         withheld on purpose: it is extra signal for a guesser, and the
         caller does not need the distinction here. */
      return false
    }
  }

  async deriveKey(password: string, params: IKdfParams): Promise<EncryptionKey> {
    if (params.algorithm !== KDF_ALGORITHM.Pbkdf2) {
      throw new InvalidArgumentError(
        'kdf.algorithm',
        `the algorithm "${params.algorithm}" is not supported by this build`,
      )
    }

    const subtle = EncryptionService.#requireSubtle()
    const passwordBytes = new TextEncoder().encode(password)

    try {
      /* Password is imported as non-extractable key material: even the
         intermediate representation must not be exportable. */
      const baseKey = await subtle.importKey(
        'raw',
        EncryptionService.#toArrayBuffer(passwordBytes),
        PBKDF2,
        false,
        ['deriveKey'],
      )

      const derived = await subtle.deriveKey(
        {
          name: PBKDF2,
          salt: EncryptionService.#toArrayBuffer(params.salt),
          iterations: params.iterations,
          hash: PBKDF2_HASH,
        },
        baseKey,
        { name: AES_GCM, length: params.keyLength * 8 },
        /* extractable: false — key bytes cannot be exported from
           JavaScript by a debugger or by serialising state. */
        false,
        ['encrypt', 'decrypt'],
      )

      return EncryptionKey.wrap(derived)
    } finally {
      wipeBytes(passwordBytes)
    }
  }

  async encryptWithKey(
    plaintext: Uint8Array,
    key: EncryptionKey,
    params: IKdfParams,
  ): Promise<IEncryptedPayload> {
    const subtle = EncryptionService.#requireSubtle()

    /* Fresh IV on every operation, no exceptions. Reusing a key+IV
       pair in AES-GCM leaks both the plaintext and the authentication
       key — not a weakening of the mode, a total loss. */
    const iv = getRandomBytes(IV_LENGTH)

    const header = {
      version: PAYLOAD_VERSION,
      cipher: CIPHER_ALGORITHM.AesGcm,
      kdf: params,
    } as const

    const ciphertext = await subtle.encrypt(
      {
        name: AES_GCM,
        iv: EncryptionService.#toArrayBuffer(iv),
        additionalData: EncryptionService.#toArrayBuffer(buildAdditionalData(header)),
        tagLength: AUTH_TAG_BITS,
      },
      key.unwrap(),
      EncryptionService.#toArrayBuffer(plaintext),
    )

    return {
      ...header,
      iv,
      ciphertext: new Uint8Array(ciphertext),
    }
  }

  async decryptWithKey(payload: IEncryptedPayload, key: EncryptionKey): Promise<ISecretBuffer> {
    EncryptionService.#assertSupportedVersion(payload)

    const subtle = EncryptionService.#requireSubtle()

    try {
      const plaintext = await subtle.decrypt(
        {
          name: AES_GCM,
          iv: EncryptionService.#toArrayBuffer(payload.iv),
          additionalData: EncryptionService.#toArrayBuffer(buildAdditionalData(payload)),
          tagLength: AUTH_TAG_BITS,
        },
        key.unwrap(),
        EncryptionService.#toArrayBuffer(payload.ciphertext),
      )

      return SecretBuffer.own(new Uint8Array(plaintext))
    } catch (error) {
      /* Web Crypto throws the same error for a wrong key, corrupted
         data, and a tampered header: the authentication tag fails in
         all three cases. Distinguishing them is impossible, and that
         is correct. */
      throw new DecryptionFailedError({ cause: error })
    }
  }

  createKdfParams(): IKdfParams {
    return createDefaultKdfParams(getRandomBytes(SALT_LENGTH))
  }

  needsUpgrade(payload: IEncryptedPayload): boolean {
    return (
      payload.version < PAYLOAD_VERSION ||
      payload.kdf.algorithm !== KDF_ALGORITHM.Pbkdf2 ||
      payload.kdf.iterations < PBKDF2_ITERATIONS
    )
  }

  /**
   * Rejects a container created by a newer app version.
   *
   * Reading an unknown format "as best we can" and then rewriting it
   * means irreversible key loss. Failing closed is the only safe
   * behaviour.
   */
  static #assertSupportedVersion(payload: IEncryptedPayload): void {
    if (payload.version > PAYLOAD_VERSION) {
      throw new UnsupportedVaultVersionError(payload.version, PAYLOAD_VERSION)
    }
  }

  static #requireSubtle(): SubtleCrypto {
    const subtle = globalThis.crypto.subtle as SubtleCrypto | undefined

    if (subtle === undefined) {
      /* Web Crypto is unavailable in an insecure context (plain http).
         A wallet must not run there at all: without it neither
         encryption nor CSPRNG is possible. */
      throw new RandomnessUnavailableError(
        'crypto.subtle is unavailable — a secure context is required (https or localhost)',
      )
    }

    return subtle
  }

  /**
   * Copies bytes into a standalone `ArrayBuffer`.
   *
   * Required because a `Uint8Array` may be a window into a larger
   * buffer: passing that array through would feed Web Crypto extra
   * bytes, or in another implementation the wrong contents. An explicit
   * slice closes that class of bugs.
   */
  static #toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
}
