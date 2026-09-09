import { describe, expect, it } from 'vitest'

import { cloudflareAuthHeaders, isCloudflareGlobalApiKey } from './credentials.ts'

describe('isCloudflareGlobalApiKey', () => {
  it('sets Bearer for an API token', () => {
    expect(cloudflareAuthHeaders('cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD', null)).toEqual({
      Authorization: 'Bearer cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    })
  })

  it('recognizes the cfk_ prefix', () => {
    expect(isCloudflareGlobalApiKey('cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(true)
  })

  it('recognizes a legacy hex key', () => {
    expect(isCloudflareGlobalApiKey('a'.repeat(37))).toBe(true)
  })

  it('does not accept Bearer tokens', () => {
    expect(isCloudflareGlobalApiKey('cfut_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(false)
    expect(isCloudflareGlobalApiKey('cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(false)
    expect(isCloudflareGlobalApiKey('Sn3lZJTBX6kkg7OdcBUAxOO963GEIyGQqnFTOFYY')).toBe(false)
  })
})
