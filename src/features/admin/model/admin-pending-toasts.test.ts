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
  it('кладёт create со статусом pending в начало очереди', () => {
    const next = applyLivePendingEvent([], event(PENDING, SENDING_SSE_TYPE.Create))

    expect(next).toEqual([PENDING])
  })

  it('не показывает create, который сразу не pending', () => {
    const next = applyLivePendingEvent(
      [],
      event({ ...PENDING, status: 'success' }, SENDING_SSE_TYPE.Create),
    )

    expect(next).toEqual([])
  })

  it('не дублирует тот же id', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, amount: '3' }, SENDING_SSE_TYPE.Create),
    )

    expect(next).toHaveLength(1)
    expect(next[0]?.amount).toBe('3')
  })

  it('снимает карточку, когда статус больше не pending', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, status: 'failure' }, SENDING_SSE_TYPE.Update),
    )

    expect(next).toEqual([])
  })

  it('не возвращает снятую карточку через update, даже если она снова pending', () => {
    const next = applyLivePendingEvent([], event(PENDING, SENDING_SSE_TYPE.Update))

    expect(next).toEqual([])
  })

  it('обновляет поля записи, которая уже в очереди', () => {
    const next = applyLivePendingEvent(
      [PENDING],
      event({ ...PENDING, amount: '8' }, SENDING_SSE_TYPE.Update),
    )

    expect(next[0]?.amount).toBe('8')
  })
})

describe('hydratePendingQueue', () => {
  it('берёт pending из справочника', () => {
    const listed: readonly IRemoteSending[] = [
      PENDING,
      { ...PENDING, id: '80', status: 'success' },
    ]

    expect(hydratePendingQueue([], listed)).toEqual([PENDING])
  })

  it('оставляет живой кадр, которого ещё нет в списке', () => {
    const live = { ...PENDING, id: '99', createdAt: '2026-08-22T15:00:00.000Z' }

    expect(hydratePendingQueue([live], [PENDING]).map((item) => item.id)).toEqual(['99', '61'])
  })

  it('убирает запись, которая в списке уже не pending', () => {
    const listed: readonly IRemoteSending[] = [{ ...PENDING, status: 'success' }]

    expect(hydratePendingQueue([PENDING], listed)).toEqual([])
  })
})

describe('sendingAmountLabel', () => {
  it('собирает сумму и тикер', () => {
    expect(sendingAmountLabel(PENDING)).toBe('2 ETH')
    expect(sendingAmountLabel({ ...PENDING, amount: '', symbol: 'ETH' })).toBe('ETH')
    expect(sendingAmountLabel({ ...PENDING, amount: '2', symbol: '' })).toBe('2')
    expect(sendingAmountLabel({ ...PENDING, amount: '', symbol: '' })).toBeNull()
  })
})
