import { describe, expect, it } from 'vitest'

import { groupLoginActivity } from './activity.ts'

describe('groupLoginActivity', () => {
  it('counts logins per user and keeps users with none', () => {
    const later = new Date('2026-09-08T12:00:00.000Z')
    const earlier = new Date('2026-09-07T08:00:00.000Z')

    const grouped = groupLoginActivity(
      [
        { id: '7', email: 'james@example.com' },
        { id: '8', email: 'maria@example.com' },
      ],
      [
        { id: 'e1', createdAt: earlier, userId: '7' },
        { id: 'e2', createdAt: later, userId: '7' },
      ],
    )

    expect(grouped[0]).toMatchObject({
      userId: '7',
      email: 'james@example.com',
      loginCount: 2,
    })
    expect(grouped[0]?.logins.map((login) => login.id)).toEqual(['e2', 'e1'])
    expect(grouped[1]).toMatchObject({
      userId: '8',
      email: 'maria@example.com',
      loginCount: 0,
      logins: [],
    })
  })

  it('keeps events for a user that is no longer in the directory', () => {
    const grouped = groupLoginActivity(
      [],
      [{ id: 'e1', createdAt: new Date('2026-09-08T12:00:00.000Z'), userId: '9' }],
    )

    expect(grouped).toEqual([
      {
        userId: '9',
        email: null,
        loginCount: 1,
        logins: [{ id: 'e1', createdAt: '2026-09-08T12:00:00.000Z' }],
      },
    ])
  })
})
