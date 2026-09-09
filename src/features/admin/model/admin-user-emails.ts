import type { IRemoteUser } from '@/features/onboarding/model/RemoteUserDirectory'

export function userEmailMap(
  users: readonly Pick<IRemoteUser, 'id' | 'email'>[],
): ReadonlyMap<string, string> {
  const emails = new Map<string, string>()

  for (const user of users) {
    if (user.email !== null && user.email !== '') {
      emails.set(user.id, user.email)
    }
  }

  return emails
}

/** Email when the directory has one; otherwise the stored user id. */
export function adminUserLabel(
  userId: string | null,
  emails: ReadonlyMap<string, string>,
): string {
  return directoryUserLabel(emails.get(userId ?? '') ?? null, userId)
}

/** Label from a joined directory row. */
export function directoryUserLabel(
  userEmail: string | null | undefined,
  userId: string | null,
): string {
  if (userEmail !== undefined && userEmail !== null && userEmail !== '') {
    return userEmail
  }

  if (userId === null || userId === '') {
    return '—'
  }

  return userId
}
