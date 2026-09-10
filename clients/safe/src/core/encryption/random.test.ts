import { afterEach, describe, expect, it, vi } from 'vitest'

import { RandomnessUnavailableError } from '@/core/errors'

import { getRandomBytes, wipeBytes } from './random'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRandomBytes', () => {
  it('returns a buffer of the requested size', () => {
    expect(getRandomBytes(16)).toHaveLength(16)
    expect(getRandomBytes(32)).toHaveLength(32)
  })

  it('returns a different value on every call', () => {
    const first = getRandomBytes(32)
    const second = getRandomBytes(32)

    expect([...first]).not.toEqual([...second])
  })

  it('rejects a zero or negative size', () => {
    expect(() => getRandomBytes(0)).toThrow(RandomnessUnavailableError)
    expect(() => getRandomBytes(-1)).toThrow(RandomnessUnavailableError)
  })

  it('rejects a fractional size', () => {
    expect(() => getRandomBytes(16.5)).toThrow(RandomnessUnavailableError)
  })

  it('rejects a size above the Web Crypto limit', () => {
    expect(() => getRandomBytes(65537)).toThrow(RandomnessUnavailableError)
  })

  it('stops when Web Crypto is missing instead of falling back to a weak generator', () => {
    vi.stubGlobal('crypto', undefined)

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
  })

  it('stops when getRandomValues is missing', () => {
    vi.stubGlobal('crypto', {})

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
  })

  it('rejects an all-zero buffer from a broken generator', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
    expect(() => getRandomBytes(32)).toThrow(RandomnessUnavailableError)
  })

  it('does not reject an all-zero result on short requests', () => {
    /* For one byte, zero is a normal CSPRNG value — it happens 1 in 256.
       Rejecting it would be a false alarm, and a false alarm in a
       security system trains people to ignore warnings. */
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect(() => getRandomBytes(1)).not.toThrow()
    expect(() => getRandomBytes(8)).not.toThrow()
  })

  it('returns zero bytes on a short request without error', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect([...getRandomBytes(2)]).toEqual([0, 0])
  })
})

describe('wipeBytes', () => {
  it('zeroes the whole buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 255])
    wipeBytes(bytes)

    expect([...bytes]).toEqual([0, 0, 0, 0])
  })

  it('is safe on an empty buffer', () => {
    expect(() => {
      wipeBytes(new Uint8Array(0))
    }).not.toThrow()
  })
})
