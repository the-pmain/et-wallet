import { afterEach, describe, expect, it, vi } from 'vitest'

import { WALLET_BROADCAST, WalletBroadcast } from './WalletBroadcast'

/** Opened channels are closed so they do not outlive the test. */
const opened: WalletBroadcast[] = []

function channel(name: string): WalletBroadcast {
  const created = new WalletBroadcast(name)

  opened.push(created)

  return created
}

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.close()
  }

  vi.unstubAllGlobals()
})

/** Wait for delivery: channel messages arrive on the next tick. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('Inter-tab notification', () => {
  it('delivers a message to another tab', async () => {
    const sender = channel('test-delivery')
    const receiver = channel('test-delivery')

    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([WALLET_BROADCAST.Erased])
  })

  it('does not echo its own message back', async () => {
    /* Otherwise the tab that erases the wallet would accept its own
       notification and handle the erase twice. */
    const sender = channel('test-self')
    const received: string[] = []

    sender.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('does not hear a foreign channel', async () => {
    const sender = channel('test-one')
    const receiver = channel('test-two')

    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('ignores an unknown message', async () => {
    /* Any same-origin code can write to the channel, including XSS.
       The value is handled, not the mere fact of a message. */
    const receiver = channel('test-foreign')
    const received: string[] = []

    receiver.subscribe((event) => {
      received.push(event)
    })

    new BroadcastChannel('test-foreign').postMessage({ kind: 'unlock-everything' })
    await settle()

    expect(received).toEqual([])
  })

  it('unsubscribe stops delivery', async () => {
    const sender = channel('test-unsubscribe')
    const receiver = channel('test-unsubscribe')

    const received: string[] = []
    const unsubscribe = receiver.subscribe((event) => {
      received.push(event)
    })

    unsubscribe()
    sender.post(WALLET_BROADCAST.Erased)
    await settle()

    expect(received).toEqual([])
  })

  it('does not crash when the channel is missing', () => {
    /* Notification is a convenience, not a condition of work. Where
       `BroadcastChannel` is unavailable, the wallet stays as it was
       before the feature existed. */
    vi.stubGlobal('BroadcastChannel', undefined)

    const created = new WalletBroadcast('test-missing')

    expect(() => {
      created.post(WALLET_BROADCAST.Erased)
      created.subscribe(() => undefined)()
      created.close()
    }).not.toThrow()
  })
})
