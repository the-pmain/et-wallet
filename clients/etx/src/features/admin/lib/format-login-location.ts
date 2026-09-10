/**
 * City / country line for a cabinet login row.
 *
 * Prefer a place name from IP geo. Timezone is the fallback when the
 * lookup did not return a city or country (older rows, or a blocked
 * geo request).
 */
export function formatLoginLocation(login: {
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly countryCode: string | null
  readonly timeZone: string | null
}): string | null {
  const city = emptyToNull(login.city)
  const country = emptyToNull(login.country)
  const region = emptyToNull(login.region)

  if (city !== null && country !== null) {
    return `${city}, ${country}`
  }

  if (city !== null) {
    return city
  }

  if (region !== null && country !== null) {
    return `${region}, ${country}`
  }

  if (country !== null) {
    return country
  }

  const code = emptyToNull(login.countryCode)

  if (code !== null) {
    return code
  }

  return emptyToNull(login.timeZone)
}

function emptyToNull(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
