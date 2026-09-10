import { describe, expect, it, vi } from 'vitest'

import { copyWithAutoClear } from './clipboard'

function createClipboard(initial = '') {
  let content = initial

  return {
    get content(): string {
      return content
    },
    writeText: vi.fn((value: string) => {
      content = value

      return Promise.resolve()
    }),
    readText: vi.fn(() => Promise.resolve(content)),
  }
}

function createScheduler() {
  let pending: (() => void) | null = null

  return {
    schedule: (handler: () => void) => {
      pending = handler

      return () => {
        pending = null
      }
    },
    run: () => {
      pending?.()
    },
    get isPending(): boolean {
      return pending !== null
    },
  }
}

describe('copyWithAutoClear', () => {
  it('copies the value to the clipboard', async () => {
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })

    expect(clipboard.content).toBe('0xabc')
  })

  it('clears the clipboard after the delay', async () => {
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })
    scheduler.run()
    await vi.waitFor(() => {
      expect(clipboard.content).toBe('')
    })
  })

  it('leaves the clipboard alone if the user copied something else', async () => {
    /* Wiping someone else's content would destroy data the wallet
       has no claim on. */
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })
    await clipboard.writeText('foreign text')

    scheduler.run()
    await vi.waitFor(() => {
      expect(clipboard.readText).toHaveBeenCalled()
    })

    expect(clipboard.content).toBe('foreign text')
  })

  it('cancel drops the scheduled clear', async () => {
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    const handle = await copyWithAutoClear('0xabc', {
      clipboard,
      schedule: scheduler.schedule,
    })

    handle.cancel()
    scheduler.run()

    expect(clipboard.content).toBe('0xabc')
  })

  it('a clipboard read denial does not take down the screen', async () => {
    const clipboard = {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.reject(new Error('Reading is forbidden'))),
    }
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })

    expect(() => {
      scheduler.run()
    }).not.toThrow()
  })
})
