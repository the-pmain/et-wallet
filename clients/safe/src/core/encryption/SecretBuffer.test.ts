import { describe, expect, it } from 'vitest'

import { SecretBufferWipedError } from '@/core/errors'

import { SecretBuffer } from './SecretBuffer'

describe('SecretBuffer: creation', () => {
  it('takes ownership of the given array', () => {
    const source = new Uint8Array([1, 2, 3])
    const buffer = SecretBuffer.own(source)

    expect(buffer.bytes).toBe(source)
  })

  it('wipes the source array on own', () => {
    const source = new Uint8Array([1, 2, 3])
    SecretBuffer.own(source).wipe()

    expect([...source]).toEqual([0, 0, 0])
  })

  it('creates an independent copy on copyOf', () => {
    const source = new Uint8Array([1, 2, 3])
    const buffer = SecretBuffer.copyOf(source)
    buffer.wipe()

    expect([...source]).toEqual([1, 2, 3])
  })

  /* Compare by spreading into a plain array, not toEqual on Uint8Array:
     TextEncoder in jsdom returns a typed array from another realm, and
     a direct object compare fails. Browsers do not have this — it is a
     test-environment quirk. */
  it('encodes text as UTF-8', () => {
    const buffer = SecretBuffer.fromUtf8('abc')

    expect([...buffer.bytes]).toEqual([97, 98, 99])
  })

  it('encodes multibyte characters correctly', () => {
    const buffer = SecretBuffer.fromUtf8('café')

    expect(buffer.byteLength).toBe(5)
  })

  it('allocates a zeroed buffer of the given size', () => {
    expect([...SecretBuffer.allocate(4).bytes]).toEqual([0, 0, 0, 0])
  })
})

describe('SecretBuffer: wiping', () => {
  it('zeroes the contents', () => {
    const source = new Uint8Array([9, 9, 9, 9])
    SecretBuffer.own(source).wipe()

    expect(source.every((byte) => byte === 0)).toBe(true)
  })

  it('marks the buffer as wiped', () => {
    const buffer = SecretBuffer.fromUtf8('secret')
    buffer.wipe()

    expect(buffer.isWiped).toBe(true)
  })

  it('denies access to the contents after wipe', () => {
    const buffer = SecretBuffer.fromUtf8('secret')
    buffer.wipe()

    expect(() => buffer.bytes).toThrow(SecretBufferWipedError)
  })

  it('allows wiping again', () => {
    const buffer = SecretBuffer.fromUtf8('secret')
    buffer.wipe()

    expect(() => {
      buffer.wipe()
    }).not.toThrow()
  })

  it('reports zero length after wipe', () => {
    const buffer = SecretBuffer.fromUtf8('secret')
    buffer.wipe()

    expect(buffer.byteLength).toBe(0)
  })
})

describe('SecretBuffer: accidental-leak guards', () => {
  /* Direct `${buffer}` in a template is not tested here: the ESLint
     `restrict-template-expressions` rule forbids interpolating a value
     that is not a string or number. So the linter already blocks that
     leak path, and the overridden toString covers the rest — String(),
     concatenation, and Array.prototype.join. */
  it('does not reveal contents when coerced to a string', () => {
    const buffer = SecretBuffer.fromUtf8('very secret phrase')

    expect(String(buffer)).toBe('[SECRET]')
    expect(buffer.toString()).not.toContain('secret')
  })

  it('does not reveal contents on concatenation', () => {
    const buffer = SecretBuffer.fromUtf8('very secret phrase')

    expect(['seed:', buffer].join(' ')).toBe('seed: [SECRET]')
  })

  it('does not reveal contents under JSON.stringify', () => {
    const buffer = SecretBuffer.fromUtf8('very secret phrase')
    const state = { mnemonic: buffer, other: 1 }

    expect(JSON.stringify(state)).not.toContain('secret')
    expect(JSON.stringify(state)).toContain('[SECRET]')
  })

  it('does not reveal contents in an array', () => {
    const buffers = [SecretBuffer.fromUtf8('word')]

    expect(JSON.stringify(buffers)).toBe('["[SECRET]"]')
  })
})
