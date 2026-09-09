/**
 * Optional login place from the browser auth body.
 *
 * The client sends IANA timezone and IP-geo city/country. Empty or
 * junk is stored as null so a bad location never blocks sign-in.
 */

export interface ILoginLocationFields {
  readonly timeZone: string | null
  readonly city: string | null
  readonly region: string | null
  readonly country: string | null
  readonly countryCode: string | null
}

export const EMPTY_LOGIN_LOCATION: ILoginLocationFields = {
  timeZone: null,
  city: null,
  region: null,
  country: null,
  countryCode: null,
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/gu

export function readLoginLocationFromAuth(body: {
  readonly time_zone?: string | null
  readonly city?: string | null
  readonly region?: string | null
  readonly country?: string | null
  readonly country_code?: string | null
}): ILoginLocationFields {
  return {
    timeZone: readOptionalText(body.time_zone, 64),
    city: readOptionalText(body.city, 128),
    region: readOptionalText(body.region, 128),
    country: readOptionalText(body.country, 128),
    countryCode: readCountryCode(body.country_code),
  }
}

function readOptionalText(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.replace(CONTROL_CHARS, '').trim()

  if (trimmed === '') {
    return null
  }

  return trimmed.slice(0, max)
}

function readCountryCode(value: string | null | undefined): string | null {
  const text = readOptionalText(value, 8)

  if (text === null) {
    return null
  }

  const code = text.toUpperCase()

  if (!/^[A-Z]{2,3}$/u.test(code)) {
    return null
  }

  return code
}
