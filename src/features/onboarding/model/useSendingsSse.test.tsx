import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TestEventSource } from '@/test/doubles'

import { SENDING_SSE_TYPE } from './sending-sse'
import { sendingsSseUrl, useSendingsSse } from './useSendingsSse'

function Probe({
  userId,
  onEvent,
  enabled,
}: {
  readonly userId: string | null
  readonly onEvent?: (event: { readonly id: string }) => void
  readonly enabled?: boolean
}) {
  useSendingsSse(userId, onEvent, enabled)
  return null
}

afterEach(() => {
  TestEventSource.reset()
})

describe('sendingsSseUrl', () => {
  it('on the same origin without user_id yields /v1/sendings', () => {
    expect(sendingsSseUrl('', null)).toBe('/v1/sendings')
  })

  it('adds user_id from the stored sign-in', () => {
    expect(sendingsSseUrl('', '70')).toBe('/v1/sendings?user_id=70')
  })

  it('joins onto the given server URL', () => {
    expect(sendingsSseUrl('http://127.0.0.1:8080', '70')).toBe(
      'http://127.0.0.1:8080/v1/sendings?user_id=70',
    )
  })
})

describe('useSendingsSse', () => {
  it('opens the sendings stream and closes it on unmount', () => {
    const { unmount } = render(<Probe userId="70" />)

    expect(TestEventSource.instances).toHaveLength(1)
    expect(TestEventSource.instances[0]?.url).toBe('/v1/sendings?user_id=70')
    expect(TestEventSource.instances[0]?.closed).toBe(false)

    unmount()

    expect(TestEventSource.instances[0]?.closed).toBe(true)
  })

  it('opens an unfiltered stream without a stored sign-in', () => {
    render(<Probe userId={null} />)

    expect(TestEventSource.instances[0]?.url).toBe('/v1/sendings')
  })

  it('does not open the stream while the subscription is off', () => {
    render(<Probe userId={null} enabled={false} />)

    expect(TestEventSource.instances).toHaveLength(0)
  })

  it('forwards a sendings frame with type_send create', () => {
    const onEvent = vi.fn()
    render(<Probe userId={null} onEvent={onEvent} />)

    const frame = {
      id: '61',
      createdAt: '2026-08-22T14:44:10.949Z',
      userId: '74',
      status: 'pending',
      failureMessage: null,
      recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: '2',
      symbol: 'ETH',
      type_send: SENDING_SSE_TYPE.Create,
    }

    TestEventSource.instances[0]?.emit('sendings', JSON.stringify(frame))

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith(frame)
  })

  it('forwards a sendings frame with type_send update', () => {
    const onEvent = vi.fn()
    render(<Probe userId="74" onEvent={onEvent} />)

    const frame = {
      id: '61',
      createdAt: '2026-08-22T14:44:10.949Z',
      userId: '74',
      status: 'failure',
      failureMessage: 'Blocked by admin',
      recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: '2',
      symbol: 'ETH',
      type_send: SENDING_SSE_TYPE.Update,
    }

    TestEventSource.instances[0]?.emit('sendings', JSON.stringify(frame))

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith(frame)
  })
})
