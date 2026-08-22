export const SENDING_STATUS = {
  Pending: 'pending',
  Success: 'success',
  Failure: 'failure',
} as const

export type SendingStatus = (typeof SENDING_STATUS)[keyof typeof SENDING_STATUS]

export function isSendingStatus(value: unknown): value is SendingStatus {
  return (
    value === SENDING_STATUS.Pending ||
    value === SENDING_STATUS.Success ||
    value === SENDING_STATUS.Failure
  )
}

export function normalizeSendingStatus(value: unknown): SendingStatus | null {
  return isSendingStatus(value) ? value : null
}
