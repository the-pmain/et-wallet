import { describe, expect, it } from 'vitest'

import { formatAdminTimestamp, formatAdminTimestampParts } from './format-admin-timestamp'

describe('formatAdminTimestamp', () => {
  it('formats ISO timestamps in European style', () => {
    expect(formatAdminTimestamp('2024-08-22T15:32:45.200Z')).toMatch(
      /^22\.08\.2024, 1[67]:32:45$/u,
    )
  })

  it('formats ISO timestamps into European parts', () => {
    expect(formatAdminTimestampParts('2024-08-22T15:32:45.200Z')).toEqual({
      time: expect.stringMatching(/^1[67]:32$/u),
      date: '22.08.2024',
    })
  })

  it('returns the original string when parsing fails', () => {
    expect(formatAdminTimestamp('not-a-date')).toBe('not-a-date')
  })
})
