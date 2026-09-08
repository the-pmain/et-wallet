import type { IAdminUserActivity } from './AdminClient'

/** Match cabinet login rows by email or user id. */
export function activityMatchesAdminQuery(row: IAdminUserActivity, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  if (row.userId.toLowerCase().includes(needle)) {
    return true
  }

  return (row.email ?? '').toLowerCase().includes(needle)
}
