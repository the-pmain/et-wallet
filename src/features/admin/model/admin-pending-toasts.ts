import {
  SENDING_SSE_TYPE,
  SENDING_STATUS,
  type IRemoteSending,
  type ISendingSseEvent,
} from '@/features/onboarding'

/** How many cards show at once. The rest become a link to the list. */
export const MAX_VISIBLE_PENDING_TOASTS = 3

/**
 * Queue of urgent pending toasts.
 *
 * A create with pending status always enters the queue: that is the
 * moment the transfer appeared and the cabinet must react at once.
 * Update removes the card if the status is no longer pending, and
 * refreshes fields if the record is still queued. A card dismissed
 * by hand is not brought back by update: otherwise edits from the
 * Sendings tab would reopen a toast the admin just closed.
 */
export function applyLivePendingEvent(
  current: readonly IRemoteSending[],
  event: ISendingSseEvent,
): readonly IRemoteSending[] {
  const sending = sendingFromEvent(event)

  if (event.type_send === SENDING_SSE_TYPE.Create && sending.status === SENDING_STATUS.Pending) {
    return uniquePending([sending, ...current])
  }

  if (sending.status !== SENDING_STATUS.Pending) {
    return current.filter((item) => item.id !== sending.id)
  }

  return uniquePending(current.map((item) => (item.id === sending.id ? sending : item)))
}

/**
 * Merge the directory list with toasts already shown.
 *
 * SSE frames can arrive before `GET /v1/admin/sendings` returns.
 * Records not yet in the list stay. Records from the list that are
 * no longer pending disappear.
 */
export function hydratePendingQueue(
  current: readonly IRemoteSending[],
  listed: readonly IRemoteSending[],
): readonly IRemoteSending[] {
  const listedById = new Map(listed.map((item) => [item.id, item]))
  const liveOnly = current.filter((item) => !listedById.has(item.id))
  const pendingListed = listed.filter((item) => item.status === SENDING_STATUS.Pending)

  return uniquePending([...liveOnly, ...pendingListed])
}

export function sendingAmountLabel(sending: IRemoteSending): string | null {
  const amount = sending.amount?.trim() ?? ''
  const symbol = sending.symbol?.trim() ?? ''

  if (amount === '' && symbol === '') {
    return null
  }

  if (amount === '') {
    return symbol
  }

  if (symbol === '') {
    return amount
  }

  return `${amount} ${symbol}`
}

export function sendingFromEvent(event: ISendingSseEvent): IRemoteSending {
  return {
    id: event.id,
    createdAt: event.createdAt,
    userId: event.userId,
    status: event.status,
    failureMessage: event.failureMessage,
    recipientAddress: event.recipientAddress,
    amount: event.amount,
    symbol: event.symbol,
  }
}

function uniquePending(sendings: readonly IRemoteSending[]): readonly IRemoteSending[] {
  const byId = new Map<string, IRemoteSending>()

  for (const item of sendings) {
    if (item.status === SENDING_STATUS.Pending && !byId.has(item.id)) {
      byId.set(item.id, item)
    }
  }

  return [...byId.values()].sort(compareNewestFirst)
}

function compareNewestFirst(left: IRemoteSending, right: IRemoteSending): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1
  }

  return left.id < right.id ? 1 : -1
}
