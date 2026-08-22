import type { IRemoteSending } from '@/features/onboarding'

/**
 * Отбор живых переводов: id, пользователь, адрес, сумма, статус, тикер.
 */
export function sendingMatchesAdminQuery(sending: IRemoteSending, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  if (sending.id.toLowerCase().includes(needle)) {
    return true
  }

  if ((sending.userId ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((sending.recipientAddress ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((sending.amount ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((sending.symbol ?? '').toLowerCase().includes(needle)) {
    return true
  }

  return (sending.status ?? '').toLowerCase().includes(needle)
}
