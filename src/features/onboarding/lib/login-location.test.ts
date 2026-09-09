import { describe, expect, it, vi } from 'vitest'

import { LOGIN_GEO_URL, readLoginLocation, toAuthLocationBody } from './login-location'

describe('readLoginLocation', () => {

  it('reads timezone from Intl and city from geojs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            city: 'London',
            region: 'England',
            country: 'United Kingdom',
            country_code: 'GB',
          }),
        ),
    })

    const location = await readLoginLocation(fetchMock as unknown as typeof fetch)

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(LOGIN_GEO_URL)
    expect(location.city).toBe('London')
    expect(location.region).toBe('England')
    expect(location.country).toBe('United Kingdom')
    expect(location.countryCode).toBe('GB')
    expect(typeof location.timeZone).toBe('string')
    expect(toAuthLocationBody(location)).toMatchObject({
      city: 'London',
      country: 'United Kingdom',
      country_code: 'GB',
      region: 'England',
    })
  })

  it('still returns timezone when geojs fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))

    const location = await readLoginLocation(fetchMock as unknown as typeof fetch)

    expect(location.city).toBeNull()
    expect(location.country).toBeNull()
    expect(typeof location.timeZone === 'string' || location.timeZone === null).toBe(true)
  })
})
