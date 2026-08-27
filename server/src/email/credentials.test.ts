import { describe, expect, it } from 'vitest'

import { cloudflareAuthHeaders, isCloudflareGlobalApiKey } from './credentials.ts'

describe('isCloudflareGlobalApiKey', () => {
  it('ставит Bearer для API-токена', () => {
    expect(cloudflareAuthHeaders('cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD', null)).toEqual({
      Authorization: 'Bearer cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    })
  })

  it('узнаёт префикс cfk_', () => {
    expect(isCloudflareGlobalApiKey('cfk_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(true)
  })

  it('узнаёт старый hex-ключ', () => {
    expect(isCloudflareGlobalApiKey('a'.repeat(37))).toBe(true)
  })

  it('не принимает токены Bearer', () => {
    expect(isCloudflareGlobalApiKey('cfut_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(false)
    expect(isCloudflareGlobalApiKey('cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toBe(false)
    expect(isCloudflareGlobalApiKey('Sn3lZJTBX6kkg7OdcBUAxOO963GEIyGQqnFTOFYY')).toBe(false)
  })
})
