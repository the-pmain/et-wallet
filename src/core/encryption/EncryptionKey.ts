import { SecretBufferWipedError } from '@/core/errors'

/**
 * Session encryption key.
 *
 * Opaque wrapper around a Web Crypto `CryptoKey`. It exists for three
 * reasons:
 *
 * 1. **The key never leaves Web Crypto.** It is created with
 *    `extractable: false`, so the key bytes cannot be exported from
 *    JavaScript at all — not by a debugger, not via `JSON.stringify`,
 *    not from a state dump. That is stronger than any buffer wipe.
 *
 * 2. **`CryptoKey` does not leak into domain contracts.** The domain
 *    must not know Web Crypto sits underneath: swapping the
 *    implementation must not touch the interfaces.
 *
 * 3. **An explicit destroy point.** `destroy()` marks the key invalid,
 *    and further operations with it are rejected.
 *
 * LIMIT OF THE GUARANTEE. `destroy()` drops the reference but does not
 * wipe key material: JavaScript cannot do that, and the browser keeps
 * the key outside the JS heap. The key disappears at GC, whose timing
 * is uncontrolled. Promising more would be a lie.
 */
export class EncryptionKey {
  #key: CryptoKey | null

  private constructor(key: CryptoKey) {
    this.#key = key
  }

  /**
   * Wraps a derived key.
   *
   * @internal Called only from `EncryptionService`.
   */
  static wrap(key: CryptoKey): EncryptionKey {
    return new EncryptionKey(key)
  }

  get isDestroyed(): boolean {
    return this.#key === null
  }

  /**
   * Key material for Web Crypto operations.
   *
   * @internal Used only by the encryption implementation.
   * @throws SecretBufferWipedError if the key has already been destroyed.
   */
  unwrap(): CryptoKey {
    if (this.#key === null) {
      throw new SecretBufferWipedError()
    }

    return this.#key
  }

  /** Marks the key invalid. A second call is safe. */
  destroy(): void {
    this.#key = null
  }

  /** Does not reveal state when coerced to a string. */
  toString(): string {
    return '[EncryptionKey]'
  }

  /** Does not reveal state when app state is serialised. */
  toJSON(): string {
    return '[EncryptionKey]'
  }
}
