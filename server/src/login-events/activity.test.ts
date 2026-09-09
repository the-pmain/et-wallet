import { describe, expect, it } from 'vitest'

import { groupLoginActivity } from './activity.ts'
import { EMPTY_LOGIN_LOCATION } from './location.ts'

function event(
  id: string,
  createdAt: string,
  userId: string,
  location: Partial<typeof EMPTY_LOGIN_LOCATION> = {},
) {
  return {
    id,
    createdAt: new Date(createdAt),
    userId,
    ...EMPTY_LOGIN_LOCATION,
    ...location,
  }
}

describe('groupLoginActivity', () => {
  it('counts logins per user and keeps users with none', () => {
    const grouped = groupLoginActivity(
      [
        { id: '7', email: 'james@example.com' },
        { id: '8', email: 'maria@example.com' },
      ],
      [
        event('e1', '2026-09-07T08:00:00.000Z', '7'),
        event('e2', '2026-09-08T12:00:00.000Z', '7', {
          city: 'London',
          country: 'United Kingdom',
          countryCode: 'GB',
          region: 'England',
          timeZone: 'Europe/London',
        }),
      ],
    )

    expect(grouped[0]).toMatchObject({
      userId: '7',
      email: 'james@example.com',
      loginCount: 2,
    })
    expect(grouped[0]?.logins.map((login) => login.id)).toEqual(['e2', 'e1'])
    expect(grouped[0]?.logins[0]).toMatchObject({
      city: 'London',
      country: 'United Kingdom',
      countryCode: 'GB',
    })
    expect(grouped[1]).toMatchObject({
      userId: '8',
      email: 'maria@example.com',
      loginCount: 0,
      logins: [],
    })
  })

  it('keeps events for a user that is no longer in the directory', () => {
    const grouped = groupLoginActivity([], [event('e1', '2026-09-08T12:00:00.000Z', '9')])

    expect(grouped).toEqual([
      {
        userId: '9',
        email: null,
        loginCount: 1,
        logins: [
          {
            id: 'e1',
            createdAt: '2026-09-08T12:00:00.000Z',
            ...EMPTY_LOGIN_LOCATION,
          },
        ],
      },
    ])
  })
})
