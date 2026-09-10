import type { IAdminUserActivity } from './AdminClient'

/** Match cabinet login rows by email, user id, or login place. */
export function activityMatchesAdminQuery(row: IAdminUserActivity, query: string): boolean {
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

  return row.logins.some((login) => loginPlaceMatches(login, needle))
}

function loginPlaceMatches(
  login: IAdminUserActivity['logins'][number],
  needle: string,
): boolean {
  return [login.city, login.region, login.country, login.countryCode, login.timeZone].some(
    (value) => value !== null && value.toLowerCase().includes(needle),
  )
}
