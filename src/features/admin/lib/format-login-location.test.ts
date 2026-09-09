import { describe, expect, it } from 'vitest'

import { formatLoginLocation } from './format-login-location'

const EMPTY = {
  city: null,
  region: null,
  country: null,
  countryCode: null,
  timeZone: null,
}

describe('formatLoginLocation', () => {
  it('prefers city and country', () => {
    expect(
      formatLoginLocation({
        ...EMPTY,
        city: 'London',
        region: 'England',
        country: 'United Kingdom',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      }),
    ).toBe('London, United Kingdom')
  })

  it('falls back to timezone when geo is missing', () => {
    expect(formatLoginLocation({ ...EMPTY, timeZone: 'Europe/London' })).toBe('Europe/London')
    expect(formatLoginLocation(EMPTY)).toBeNull()
  })
})
