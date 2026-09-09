import type { IUserRecord } from '../users/contracts.ts'

import type { ILoginEventRecord } from './contracts.ts'

export interface ILoginActivityLogin {
  readonly id: string
  readonly createdAt: string
  readonly timeZone: string | null
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly countryCode: string | null
}

/** One directory user with the logins recorded for them. */
export interface IUserLoginActivity {
  readonly userId: string
  readonly email: string | null
  readonly loginCount: number
  readonly logins: readonly ILoginActivityLogin[]
}

/**
 * Groups login rows by user for the admin list.
 *
 * Directory users with no events stay in the list (count 0). Events
 * whose `user_id` no longer matches a user still appear, with
 * `email` null: deleting a row must not hide the audit trail.
 */
export function groupLoginActivity(
  users: readonly Pick<IUserRecord, 'id' | 'email'>[],
  events: readonly ILoginEventRecord[],
): readonly IUserLoginActivity[] {
  const eventsByUser = new Map<string, ILoginEventRecord[]>()

  for (const event of events) {
    const existing = eventsByUser.get(event.userId)

    if (existing === undefined) {
      eventsByUser.set(event.userId, [event])
    } else {
      existing.push(event)
    }
  }

  const rows: IUserLoginActivity[] = []
  const seen = new Set<string>()

  for (const user of users) {
    seen.add(user.id)
    rows.push(toActivityRow(user.id, user.email, eventsByUser.get(user.id) ?? []))
  }

  for (const [userId, userEvents] of eventsByUser) {
    if (seen.has(userId)) {
      continue
    }

    rows.push(toActivityRow(userId, null, userEvents))
  }

  return rows.sort(compareActivity)
}

function toActivityRow(
  userId: string,
  email: string | null,
  events: readonly ILoginEventRecord[],
): IUserLoginActivity {
  const logins = [...events]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      timeZone: event.timeZone,
      city: event.city,
      region: event.region,
      country: event.country,
      countryCode: event.countryCode,
    }))

  return {
    userId,
    email,
    loginCount: logins.length,
    logins,
  }
}

function compareActivity(left: IUserLoginActivity, right: IUserLoginActivity): number {
  const leftLast = left.logins[0]?.createdAt ?? ''
  const rightLast = right.logins[0]?.createdAt ?? ''

  if (leftLast !== rightLast) {
    return rightLast.localeCompare(leftLast)
  }

  return (left.email ?? '').localeCompare(right.email ?? '')
}
