import { describe, expect, it } from 'vitest'

import { SENDING_SSE_TYPE, type IRemoteSending, type ISendingSseEvent } from '@/features/onboarding'

import {
  applyLivePendingEvent,
  hydratePendingQueue,
  sendingAmountLabel,
} from './admin-pending-toasts'

const PENDING: IRemoteSending = {
  id: '61',
  createdAt: '2026-08-22T14:44:10.949Z',
  userId: '74',
  status: 'pending',
  failureMessage: null,
  recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  amount: '2',
  symbol: 'ETH',
}

function event(
  sending: IRemoteSending,
  typeSend: (typeof SENDING_SSE_TYPE)[keyof typeof SENDING_SSE_TYPE],
): ISendingSseEvent {
  return { ...sending, type_send: typeSend }
}

describe('applyLivePendingEvent', () => {
  it('puts a pending create at the front of the queue', () => {
    const next = applyLivePendingEvent([], event(PENDING, SENDING_SSE_TYPE.Create))

    expect(next).toEqual([PENDING])
  })

  it('does not show a create that is not pending from the start', () => {
    const next = applyLivePendingEvent(
      [],
      event({ ...PENDING, status: 'success' }, SENDING_SSE_TYPE.Create),
    )

    expect(next).toEqual([])
  })

  it('does not duplicate the same id', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, amount: '3' }, SENDING_SSE_TYPE.Create),
    )

    expect(next).toHaveLength(1)
    expect(next[0]?.amount).toBe('3')
  })

  it('removes the card when the status is no longer pending', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, status: 'failure' }, SENDING_SSE_TYPE.Update),
    )

    expect(next).toEqual([])
  })

  it('does not restore a dismissed card via update, even if it is pending again', () => {
    const next = applyLivePendingEvent([], event(PENDING, SENDING_SSE_TYPE.Update))

    expect(next).toEqual([])
  })

  it('updates fields of a record already in the queue', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, amount: '8' }, SENDING_SSE_TYPE.Update),
    )

    expect(next[0]?.amount).toBe('8')
  })
})

describe('hydratePendingQueue', () => {
  it('takes pending items from the directory', () => {
    const listed: readonly IRemoteSending[] = [
      PENDING,
      { ...PENDING, id: '80', status: 'success' },
    ]

    expect(hydratePendingQueue([], listed)).toEqual([PENDING])
  })

  it('keeps a live frame that is not yet in the list', () => {
    const live = { ...PENDING, id: '99', createdAt: '2026-08-22T15:00:00.000Z' }

    expect(hydratePendingQueue([live], [PENDING]).map((item) => item.id)).toEqual(['99', '61'])
  })

  it('drops a record that is no longer pending in the list', () => {
    const listed: readonly IRemoteSending[] = [{ ...PENDING, status: 'success' }]

    expect(hydratePendingQueue([PENDING], listed)).toEqual([])
  })
})

describe('sendingAmountLabel', () => {
  it('joins amount and ticker', () => {
    expect(sendingAmountLabel(PENDING)).toBe('2 ETH')
    expect(sendingAmountLabel({ ...PENDING, amount: '', symbol: 'ETH' })).toBe('ETH')
    expect(sendingAmountLabel({ ...PENDING, amount: '2', symbol: '' })).toBe('2')
    expect(sendingAmountLabel({ ...PENDING, amount: '', symbol: '' })).toBeNull()
  })
})
