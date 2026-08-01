import { describe, expect, it, vi } from 'vitest'

import { EventBus } from './EventBus'

interface TestEventMap {
  ping: { readonly value: number }
  pong: { readonly text: string }
}

describe('EventBus', () => {
  it('доставляет событие подписчику', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 1 })
  })

  it('не доставляет событие подписчикам другого события', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('pong', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('снимает подписку возвращённой функцией', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    const unsubscribe = bus.on('ping', listener)
    unsubscribe()
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('снимает подписку методом off', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('ping', listener)
    bus.off('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('вызывает одноразовый обработчик ровно один раз', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.once('ping', listener)
    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })

    expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 1 })
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('позволяет снять одноразовую подписку через off до срабатывания', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.once('ping', listener)
    bus.off('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('продолжает рассылку после исключения в обработчике', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus<TestEventMap>({ onListenerError })
    const failing = vi.fn(() => {
      throw new Error('сбой подписчика')
    })
    const healthy = vi.fn()

    bus.on('ping', failing)
    bus.on('ping', healthy)

    expect(() => {
      bus.emit('ping', { value: 1 })
    }).not.toThrow()
    expect(healthy).toHaveBeenCalledOnce()
  })

  it('передаёт сбой подписчика заданному обработчику', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus<TestEventMap>({ onListenerError })
    const error = new Error('сбой подписчика')

    bus.on('ping', () => {
      throw error
    })
    bus.emit('ping', { value: 1 })

    expect(onListenerError).toHaveBeenCalledExactlyOnceWith(error, 'ping')
  })

  it('допускает отписку изнутри обработчика', () => {
    const bus = new EventBus<TestEventMap>()
    const second = vi.fn()
    const first = vi.fn(() => {
      bus.off('ping', second)
    })

    bus.on('ping', first)
    bus.on('ping', second)
    bus.emit('ping', { value: 1 })

    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('снимает все подписки', () => {
    const bus = new EventBus<TestEventMap>()

    bus.on('ping', vi.fn())
    bus.on('pong', vi.fn())
    bus.removeAllListeners()

    expect(bus.listenerCount('ping')).toBe(0)
    expect(bus.listenerCount('pong')).toBe(0)
  })

  it('не падает при событии без подписчиков', () => {
    const bus = new EventBus<TestEventMap>()

    expect(() => {
      bus.emit('ping', { value: 1 })
    }).not.toThrow()
  })
})
