import { describe, expect, it } from 'vitest'

import { activityMatchesAdminQuery } from './activity-query'

const JAMES = {
  userId: '7',
  email: 'james@example.com',
  loginCount: 2,
  logins: [
    { id: 'e2', createdAt: '2026-09-08T12:04:21.000Z' },
    { id: 'e1', createdAt: '2026-09-07T08:12:03.000Z' },
  ],
}

const MARIA = {
  userId: '8',
  email: 'maria@example.com',
  loginCount: 0,
  logins: [],
}

describe('activityMatchesAdminQuery', () => {
  it('finds a record by email', () => {
    expect(activityMatchesAdminQuery(JAMES, 'james@')).toBe(true)
    expect(activityMatchesAdminQuery(MARIA, 'james@')).toBe(false)
  })

  it('finds a record by user id', () => {
    expect(activityMatchesAdminQuery(JAMES, '7')).toBe(true)
    expect(activityMatchesAdminQuery(MARIA, '7')).toBe(false)
  })

  it('an empty query does not filter anyone out', () => {
    expect(activityMatchesAdminQuery(JAMES, '  ')).toBe(true)
    expect(activityMatchesAdminQuery(MARIA, '')).toBe(true)
  })
})
