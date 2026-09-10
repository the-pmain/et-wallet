import { SecretBufferWipedError } from '@/core/errors'

import { wipeBytes } from './random'
import type { ISecretBuffer } from './types'

/** Value substituted when something tries to serialise the secret. */
const REDACTED = '[SECRET]'

/**
 * Ownership of a secret in memory.
 *
 * WHY THIS EXISTS. `string` is unfit for secrets: JavaScript strings are
 * immutable and interned, so their contents cannot be wiped — they stay
 * on the heap until garbage collection, whose timing is uncontrolled.
 * `Uint8Array` can be wiped explicitly.
 *
 * WHAT THIS CLASS DOES NOT GIVE. Wiping shortens the window the secret
 * is in memory, but does not remove the risk: V8 uses a moving GC and
 * may copy the buffer, leaving the old copy on a freed page. This is
 * not process-dump protection, and promising otherwise would be a lie.
 *
 * ACCIDENTAL-LEAK GUARDS. `toString` and `toJSON` are overridden.
 * Without them the secret lands in logs via a template string and in
 * debug dumps via `JSON.stringify` of app state — the two most common
 * ways to leak a key by accident.
 *
 * RULES:
 * - call `wipe()` in a `finally` block immediately after use;
 * - do not keep it in UI state or pass it across layers longer than one
 *   operation requires;
 * - do not copy `bytes` without wiping the copy afterwards.
 */
export class SecretBuffer implements ISecretBuffer {
  #bytes: Uint8Array | null

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  /**
   * Takes ownership of the given array.
   *
   * The caller must not use the original reference again: `wipe()`
   * zeroes that same memory.
   */
  static own(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(bytes)
  }

  /**
   * Creates an independent copy.
   *
   * Needed when the source array belongs to another owner who will
   * wipe it themselves.
   */
  static copyOf(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(Uint8Array.from(bytes))
  }

  /**
   * Encodes text into a buffer.
   *
   * WARNING: the source string stays on the heap and cannot be wiped.
   * This method does not close that leak — it confines it to the one
   * value the caller already created.
   */
  static fromUtf8(text: string): SecretBuffer {
    return new SecretBuffer(new TextEncoder().encode(text))
  }

  static allocate(size: number): SecretBuffer {
    return new SecretBuffer(new Uint8Array(size))
  }

  /**
   * Buffer contents.
   *
   * @throws SecretBufferWipedError if the buffer has already been wiped.
   *         An exception, not an empty array: silently returning zeroes
   *         would derive a key from an empty secret.
   */
  get bytes(): Uint8Array {
    if (this.#bytes === null) {
      throw new SecretBufferWipedError()
    }

    return this.#bytes
  }

  get isWiped(): boolean {
    return this.#bytes === null
  }

  /** Byte length. Available after wipe — it is not a secret. */
  get byteLength(): number {
    return this.#bytes?.length ?? 0
  }

  /**
   * Zeroes the contents and marks the buffer invalid.
   * A second call is safe.
   */
  wipe(): void {
    if (this.#bytes === null) {
      return
    }

    wipeBytes(this.#bytes)
    this.#bytes = null
  }

  /** Does not reveal contents when coerced to a string. */
  toString(): string {
    return REDACTED
  }

  /** Does not reveal contents under JSON.stringify. */
  toJSON(): string {
    return REDACTED
  }
}
