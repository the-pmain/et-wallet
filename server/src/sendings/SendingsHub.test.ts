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
  it('sends an event to a subscriber of the same user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe('70', send)
    hub.publish(EVENT)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(EVENT)
  })

  it('does not send an event to another user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe('60', send)
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send an event to a subscription without user_id', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribe(null, send)
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends every event to a subscribeAll subscription', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    hub.subscribeAll(send)
    hub.publish(EVENT)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(EVENT)
  })

  it('after unsubscribe no longer calls the listener', () => {
    const hub = new SendingsHub()
    const send = vi.fn()
    const unsubscribe = hub.subscribe('70', send)
    unsubscribe()
    hub.publish(EVENT)
    expect(send).not.toHaveBeenCalled()
    expect(hub.size).toBe(0)
  })

  it('formats an SSE frame with name sendings and type_send', () => {
    expect(formatSendingsSseFrame(EVENT)).toBe(
      `event: sendings\ndata: ${JSON.stringify(EVENT)}\n\n`,
    )
  })
})
