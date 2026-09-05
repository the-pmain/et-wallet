import { describe, expect, it, vi } from 'vitest'

import { EventBus } from './EventBus'

interface TestEventMap {
  ping: { readonly value: number }
  pong: { readonly text: string }
}

describe('EventBus', () => {
  it('delivers an event to a subscriber', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 1 })
  })

  it('does not deliver an event to subscribers of another event', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('pong', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes a subscription with the returned function', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    const unsubscribe = bus.on('ping', listener)
    unsubscribe()
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('removes a subscription with off', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.on('ping', listener)
    bus.off('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('calls a one-shot handler exactly once', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.once('ping', listener)
    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })

    expect(listener).toHaveBeenCalledExactlyOnceWith({ value: 1 })
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('allows removing a one-shot subscription with off before it fires', () => {
    const bus = new EventBus<TestEventMap>()
    const listener = vi.fn()

    bus.once('ping', listener)
    bus.off('ping', listener)
    bus.emit('ping', { value: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('continues delivery after an exception in a handler', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus<TestEventMap>({ onListenerError })
    const failing = vi.fn(() => {
      throw new Error('subscriber failure')
    })
    const healthy = vi.fn()

    bus.on('ping', failing)
    bus.on('ping', healthy)

    expect(() => {
      bus.emit('ping', { value: 1 })
    }).not.toThrow()
    expect(healthy).toHaveBeenCalledOnce()
  })

  it('passes a subscriber failure to the given handler', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus<TestEventMap>({ onListenerError })
    const error = new Error('subscriber failure')

    bus.on('ping', () => {
      throw error
    })
    bus.emit('ping', { value: 1 })

    expect(onListenerError).toHaveBeenCalledExactlyOnceWith(error, 'ping')
  })

  it('allows unsubscribing from inside a handler', () => {
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

  it('removes every subscription', () => {
    const bus = new EventBus<TestEventMap>()

    bus.on('ping', vi.fn())
    bus.on('pong', vi.fn())
    bus.removeAllListeners()

    expect(bus.listenerCount('ping')).toBe(0)
    expect(bus.listenerCount('pong')).toBe(0)
  })

  it('does not throw on an event with no subscribers', () => {
    const bus = new EventBus<TestEventMap>()

    expect(() => {
      bus.emit('ping', { value: 1 })
    }).not.toThrow()
  })
})
