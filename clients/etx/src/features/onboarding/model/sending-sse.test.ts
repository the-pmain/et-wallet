import { describe, expect, it } from 'vitest'

import { parseSendingSseEvent, SENDING_SSE_TYPE } from './sending-sse'

const CREATE = {
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

describe('parseSendingSseEvent', () => {
  it('разбирает кадр type_send create', () => {
    expect(parseSendingSseEvent(JSON.stringify(CREATE))).toEqual(CREATE)
  })

  it('разбирает кадр type_send update', () => {
    const update = { ...CREATE, status: 'failure', type_send: SENDING_SSE_TYPE.Update }

    expect(parseSendingSseEvent(JSON.stringify(update))).toEqual(update)
  })

  it('отбрасывает кадр с неизвестным type_send', () => {
    expect(parseSendingSseEvent(JSON.stringify({ ...CREATE, type_send: 'other' }))).toBeNull()
  })

  it('отбрасывает битый JSON', () => {
    expect(parseSendingSseEvent('not-json')).toBeNull()
  })
})
