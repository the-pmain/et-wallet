import { describe, expect, it } from 'vitest'

import { adminUserLabel, directoryUserLabel, userEmailMap } from './admin-user-emails'

describe('adminUserLabel', () => {
  const emails = userEmailMap([
    { id: '7', email: 'james@example.com' },
    { id: '8', email: null },
  ])

  it('uses the directory email', () => {
    expect(adminUserLabel('7', emails)).toBe('james@example.com')
  })

  it('falls back to the user id when email is missing', () => {
    expect(adminUserLabel('8', emails)).toBe('8')
    expect(adminUserLabel('74', emails)).toBe('74')
  })

  it('renders an em dash without a user id', () => {
    expect(adminUserLabel(null, emails)).toBe('—')
    expect(adminUserLabel('', emails)).toBe('—')
  })
})

describe('directoryUserLabel', () => {
  it('prefers the joined email', () => {
    expect(directoryUserLabel('leo@example.com', '74')).toBe('leo@example.com')
  })

  it('falls back to the user id', () => {
    expect(directoryUserLabel(null, '74')).toBe('74')
    expect(directoryUserLabel(undefined, '74')).toBe('74')
  })
})
