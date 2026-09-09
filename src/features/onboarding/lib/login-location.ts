/**
 * Place of a successful app sign-in, from the browser.
 *
 * Timezone is IANA from `Intl` (always available, no permission).
 * City/country come from geojs IP geolocation. GPS is not used.
 * A failed lookup still signs in; only timezone may be sent.
 */

export const LOGIN_GEO_URL = 'https://get.geojs.io/v1/ip/geo.json'
const GEO_TIMEOUT_MS = 2500

export interface ILoginLocation {
  readonly timeZone: string | null
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly countryCode: string | null
}

export async function readLoginLocation(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  timeoutMs: number = GEO_TIMEOUT_MS,
): Promise<ILoginLocation> {
  const timeZone = readTimeZone()
  const geo = await readIpGeo(fetchImpl, timeoutMs)

  return {
    timeZone,
    city: geo.city,
    region: geo.region,
    country: geo.country,
    countryCode: geo.countryCode,
  }
}

export function toAuthLocationBody(location: ILoginLocation): Record<string, string> {
  const body: Record<string, string> = {}

  if (location.timeZone !== null) {
    body['time_zone'] = location.timeZone
  }

  if (location.city !== null) {
    body['city'] = location.city
  }

  if (location.region !== null) {
    body['region'] = location.region
  }

  if (location.country !== null) {
    body['country'] = location.country
  }

  if (location.countryCode !== null) {
    body['country_code'] = location.countryCode
  }

  return body
}

function readTimeZone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    return clip(timeZone, 64)
  } catch {
    return null
  }
}

async function readIpGeo(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Omit<ILoginLocation, 'timeZone'>> {
  const empty = {
    city: null,
    region: null,
    country: null,
    countryCode: null,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(LOGIN_GEO_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const raw = await response.text()

    if (!response.ok) {
      return empty
    }

    return parseGeojs(raw)
  } catch {
    return empty
  } finally {
    clearTimeout(timer)
  }
}

function parseGeojs(raw: string): Omit<ILoginLocation, 'timeZone'> {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return { city: null, region: null, country: null, countryCode: null }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return { city: null, region: null, country: null, countryCode: null }
  }

  const record = parsed as Record<string, unknown>

  return {
    city: clip(record['city'], 128),
    region: clip(record['region'], 128),
    country: clip(record['country'], 128),
    countryCode: readCountryCode(record['country_code']),
  }
}

function readCountryCode(value: unknown): string | null {
  const text = clip(value, 8)

  if (text === null) {
    return null
  }

  const code = text.toUpperCase()

  if (!/^[A-Z]{2,3}$/u.test(code)) {
    return null
  }

  return code
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    return null
  }

  return trimmed.slice(0, max)
}
