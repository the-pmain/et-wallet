/**
 * Статусы перевода. Одно множество на кабинет и на экран отправки:
 * иначе выпадающий список и кадр SSE разойдутся по строкам.
 */
export const SENDING_STATUS = {
  Pending: 'pending',
  Success: 'success',
  Failure: 'failure',
} as const

export type SendingStatus = (typeof SENDING_STATUS)[keyof typeof SENDING_STATUS]

export const SENDING_STATUSES = [
  SENDING_STATUS.Pending,
  SENDING_STATUS.Success,
  SENDING_STATUS.Failure,
] as const
