import type { IUserLoginActivity } from '../login-events/activity.ts'
import type { IUserRecord } from '../users/contracts.ts'

/** Match a cabinet transfer by id, user, email, address, amount, ticker, or status. */
export function directoryTransferMatches(
  record: {
    readonly id: string
    readonly userId: string | null
    readonly status: string | null
    readonly recipientAddress: string | null
    readonly amount: string | null
    readonly symbol: string | null
    readonly usdAmount?: string | null
  },
  query: string,
  email: string | null,
): boolean {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  if (record.id.toLowerCase().includes(needle)) {
    return true
  }

  if ((record.userId ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((email ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((record.recipientAddress ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((record.amount ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((record.symbol ?? '').toLowerCase().includes(needle)) {
    return true
  }

  if ((record.usdAmount ?? '').toLowerCase().includes(needle)) {
    return true
  }

  return (record.status ?? '').toLowerCase().includes(needle)
}

/** Match a directory user by id, email, or a wallet address. */
export function directoryUserMatches(user: IUserRecord, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  if (user.id.toLowerCase().includes(needle)) {
    return true
  }

  if ((user.email ?? '').toLowerCase().includes(needle)) {
    return true
  }

  return Object.values(user.wallets).some((entry) => entry.key.toLowerCase().includes(needle))
}

/** Match a login-activity row by user id, email, or place. */
export function directoryActivityMatches(row: IUserLoginActivity, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  if (row.userId.toLowerCase().includes(needle)) {
    return true
  }

  if ((row.email ?? '').toLowerCase().includes(needle)) {
    return true
  }

  return row.logins.some((login) =>
    [login.city, login.region, login.country, login.countryCode, login.timeZone].some(
      (value) => value !== null && value.toLowerCase().includes(needle),
    ),
  )
}
