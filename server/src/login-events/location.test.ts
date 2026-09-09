import { describe, expect, it } from 'vitest'

import { EMPTY_LOGIN_LOCATION, readLoginLocationFromAuth } from './location.ts'

describe('readLoginLocationFromAuth', () => {
  it('reads timezone and IP-geo fields', () => {
    expect(
      readLoginLocationFromAuth({
        time_zone: 'Europe/London',
        city: 'London',
        region: 'England',
        country: 'United Kingdom',
        country_code: 'gb',
      }),
    ).toEqual({
      timeZone: 'Europe/London',
      city: 'London',
      region: 'England',
      country: 'United Kingdom',
      countryCode: 'GB',
    })
  })

  it('empty and missing become null', () => {
    expect(readLoginLocationFromAuth({})).toEqual(EMPTY_LOGIN_LOCATION)
    expect(
      readLoginLocationFromAuth({
        time_zone: '  ',
        city: null,
        country_code: 'G',
      }),
    ).toEqual(EMPTY_LOGIN_LOCATION)
  })
})
