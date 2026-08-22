import { describe, expect, it, vi } from 'vitest'

import { SENDING_SSE_TYPE } from '../api/contracts.ts'

import { SendingsHub, formatSendingsSseFrame } from './SendingsHub.ts'

const EVENT = {
  id: '12',
  createdAt: '2026-08-22T14:00:00.000Z',
  userId: '70',
  status: 'pending' as const,
  failureMessage: null,
  recipientAddress: '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  amount: '0.5',
  symbol: 'ETH',
  type_send: SENDING_SSE_TYPE.Create,
}

describe('SendingsHub', () => {
  it('шлёт событие подписчику того же user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe('70', send)
    hub.publish(EVENT)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(EVENT)
  })

  it('не шлёт событие чужому user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe('60', send)
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
  })

  it('не шлёт событие подписке без user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe(null, send)
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
  })

  it('шлёт все события подписке subscribeAll', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribeAll(send)
    hub.publish(EVENT)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(EVENT)
  })

  it('после отписки больше не вызывает слушателя', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    const unsubscribe = hub.subscribe('70', send)
    unsubscribe()
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
    expect(hub.size).toBe(0)
  })

  it('форматирует кадр SSE с именем sendings и type_send', () => {
    expect(formatSendingsSseFrame(EVENT)).toBe(
      `event: sendings\ndata: ${JSON.stringify(EVENT)}\n\n`,
    )
  })
})
