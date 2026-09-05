import { describe, expect, it } from 'vitest'

import { compareVersions, isValidVersion, parseVersion } from './version.ts'

describe('isValidVersion', () => {
  it('accepts MAJOR.MINOR.PATCH', () => {
    expect(isValidVersion('1.2.3')).toBe(true)
    expect(isValidVersion('0.0.0')).toBe(true)
    expect(isValidVersion('10.20.30')).toBe(true)
  })

  it('rejects incomplete and extra parts', () => {
    expect(isValidVersion('1.2')).toBe(false)
    expect(isValidVersion('1.2.3.4')).toBe(false)
    expect(isValidVersion('')).toBe(false)
  })

  it('rejects pre-release tags', () => {
    /* Pre-release ordering rules are not encoded here. Accepting
       such a string would compare it wrongly and silently. */
    expect(isValidVersion('1.2.3-beta.1')).toBe(false)
    expect(isValidVersion('v1.2.3')).toBe(false)
  })
})

describe('parseVersion', () => {
  it('parses parts into numbers', () => {
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 })
  })

  it('refuses instead of returning zeros', () => {
    /* Zero instead of an unparsed version would mean "version 0.0.0",
       i.e. already outdated — a claim from nothing. */
    expect(() => parseVersion('not a version')).toThrow(/MAJOR\.MINOR\.PATCH/u)
  })
})

describe('compareVersions', () => {
  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('compares parts by precedence', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
  })

  it('compares numbers, not strings', () => {
    /* String compare would rank `0.10.0` below `0.9.0` and call a
       fresh version outdated. */
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })
})
