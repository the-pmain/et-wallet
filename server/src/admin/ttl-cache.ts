/**
 * Short-lived in-process value.
 *
 * Concurrent readers share one load. A failed load is not stored.
 */
export class TtlCache<T> {
  readonly #now: () => number
  readonly #ttlMs: number
  #value: T | null = null
  #expiresAt = 0
  #inflight: Promise<T> | null = null

  constructor(options: { readonly now?: () => number; readonly ttlMs: number }) {
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs
  }

  peek(): T | null {
    if (this.#value !== null && this.#now() < this.#expiresAt) {
      return this.#value
    }

    return null
  }

  async get(load: () => Promise<T>): Promise<T> {
    const fresh = this.peek()

    if (fresh !== null) {
      return fresh
    }

    if (this.#inflight !== null) {
      return await this.#inflight
    }

    const pending = load().then((value) => {
      this.#value = value
      this.#expiresAt = this.#now() + this.#ttlMs

      return value
    })

    this.#inflight = pending

    try {
      return await pending
    } finally {
      this.#inflight = null
    }
  }

  invalidate(): void {
    this.#value = null
    this.#expiresAt = 0
  }
}
