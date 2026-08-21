import type { IRemoteUser } from '@/features/onboarding/model/RemoteUserDirectory'

/**
 * Отбор записей кабинета: почта, id или адрес из колонки `wallets`.
 */
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

  return user.wallets.some((entry) => entry.key.toLowerCase().includes(needle))
}
