import type { Unsubscribe } from '@/core'

/**
 * Event that tabs must learn from one another.
 *
 * THE LIST IS SHORT ON PURPOSE. The inter-tab channel carries only
 * the fact of an event: no keys, addresses, or amounts. Any code of
 * the same origin can read it, including XSS, so anything sent must
 * be treated as disclosed.
 */
export const WALLET_BROADCAST = {
  /**
   * The wallet was erased from the device.
   *
   * The only event that must cross the tab boundary: it destroys a
   * shared resource. Lock, network change, and the rest are one tab's
   * decisions and need not be imposed on the others.
   */
  Erased: 'wallet-erased',
} as const

export type WalletBroadcastEvent = (typeof WALLET_BROADCAST)[keyof typeof WALLET_BROADCAST]

/**
 * Notify other tabs of the same wallet.
 *
 * WHY THIS EXISTS. Tabs share storage, not memory: each has its own
 * encryption key and state snapshot. A tab that survived a wallet
 * erase in a sibling kept showing balances and offering send — its
 * keys were still in memory. The owner saw a working wallet already
 * gone from disk; worse, someone who erased the wallet before handing
 * the device over left a door open.
 *
 * WHY `BroadcastChannel`, NOT A STORAGE EVENT. `storage` events come
 * only from `localStorage`, which this project forbids; IndexedDB
 * does not notify at all. Polling the database would mean constant
 * work for an event that happens once in a wallet's life.
 *
 * A MISSING CHANNEL IS NOT AN ERROR. In environments without
 * `BroadcastChannel`, notification simply does not run: the wallet
 * stays as it was before this feature. Crashing the app for a missing
 * convenience is not allowed.
 */
export class WalletBroadcast {
  readonly #channel: BroadcastChannel | null

  constructor(name = 'etwallet') {
    this.#channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)
  }

  post(event: WalletBroadcastEvent): void {
    this.#channel?.postMessage(event)
  }

  /**
   * Subscribe to events from sibling tabs.
   *
   * Own messages are not echoed back — that is how `BroadcastChannel`
   * works, so no extra loop guard is needed.
   */
  subscribe(handler: (event: WalletBroadcastEvent) => void): Unsubscribe {
    const channel = this.#channel

    if (channel === null) {
      return () => undefined
    }

    const listener = (message: MessageEvent<unknown>): void => {
      /* Check the value, not the type: any same-origin code can write
         to the channel, including injected code. Unknown messages
         are ignored. */
      if (message.data === WALLET_BROADCAST.Erased) {
        handler(WALLET_BROADCAST.Erased)
      }
    }

    channel.addEventListener('message', listener)

    return () => {
      channel.removeEventListener('message', listener)
    }
  }

  close(): void {
    this.#channel?.close()
  }
}
