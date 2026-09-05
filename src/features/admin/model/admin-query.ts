import type { IRemoteUser } from '@/features/onboarding/model/RemoteUserDirectory'

/** Match cabinet records by email, id, or an address from `wallets`. */
export function userMatchesAdminQuery(user: IRemoteUser, query: string): boolean {
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
