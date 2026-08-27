import {
  SENDING_SSE_TYPE,
  SENDING_STATUS,
  type IRemoteSending,
  type ISendingSseEvent,
} from '@/features/onboarding'

/** Сколько карточек видно сразу. Остальные — ссылкой на список. */
export const MAX_VISIBLE_PENDING_TOASTS = 3

/**
 * Очередь срочных pending-тостов.
 *
 * Create со статусом pending всегда попадает в очередь: это момент,
 * когда перевод только появился и кабинет должен среагировать сразу.
 * Update снимает карточку, если статус уже не pending, и обновляет
 * поля, если запись ещё в очереди. Снятую вручную карточку update
 * не возвращает: иначе правки с вкладки Sendings снова открывали бы
 * тост, который администратор только что закрыл.
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
 * Сливает список справочника с уже показанными тостами.
 *
 * Кадры SSE могут прийти раньше ответа `GET /v1/admin/sendings`.
 * Записи, которых ещё нет в списке, остаются. Записи из списка,
 * которые уже не pending, исчезают.
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

/** Сумма и тикер одной строкой, либо `null`, если обоих нет. */
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
