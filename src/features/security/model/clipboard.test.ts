import { describe, expect, it, vi } from 'vitest'

import { copyWithAutoClear } from './clipboard'

/** Буфер обмена-дублёр с управляемым содержимым. */
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

/** Планировщик, запускаемый вручную. */
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
  it('копирует значение в буфер', async () => {
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })

    expect(clipboard.content).toBe('0xabc')
  })

  it('очищает буфер по истечении срока', async () => {
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })
    scheduler.run()
    await vi.waitFor(() => {
      expect(clipboard.content).toBe('')
    })
  })

  it('не трогает буфер, если пользователь скопировал что-то ещё', async () => {
    /* Стереть чужое содержимое значило бы уничтожить данные, к которым
       кошелёк отношения не имеет. */
    const clipboard = createClipboard()
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })
    await clipboard.writeText('чужой текст')

    scheduler.run()
    await vi.waitFor(() => {
      expect(clipboard.readText).toHaveBeenCalled()
    })

    expect(clipboard.content).toBe('чужой текст')
  })

  it('отмена снимает запланированную очистку', async () => {
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

  it('запрет на чтение буфера не роняет экран', async () => {
    const clipboard = {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.reject(new Error('Чтение запрещено'))),
    }
    const scheduler = createScheduler()

    await copyWithAutoClear('0xabc', { clipboard, schedule: scheduler.schedule })

    expect(() => {
      scheduler.run()
    }).not.toThrow()
  })
})
