import { afterEach, describe, expect, it } from 'vitest'

import { pinMatches, resolveAdminRole } from './pin.ts'

const previousAdmin = process.env['ADMIN_PIN']
const previousSuper = process.env['SUPER_ADMIN_PIN']

function setPin(name: 'ADMIN_PIN' | 'SUPER_ADMIN_PIN', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]

    return
  }

  process.env[name] = value
}

afterEach(() => {
  if (previousAdmin === undefined) {
    delete process.env['ADMIN_PIN']
  } else {
    process.env['ADMIN_PIN'] = previousAdmin
  }

  if (previousSuper === undefined) {
    delete process.env['SUPER_ADMIN_PIN']
  } else {
    process.env['SUPER_ADMIN_PIN'] = previousSuper
  }
})

describe('admin pin', () => {
  it('принимает значение из ADMIN_PIN как роль admin', () => {
    setPin('ADMIN_PIN', 'test-admin-pin')
    setPin('SUPER_ADMIN_PIN', undefined)

    expect(resolveAdminRole('test-admin-pin')).toBe('admin')
    expect(pinMatches('test-admin-pin')).toBe(true)
  })

  it('принимает значение из SUPER_ADMIN_PIN как роль super', () => {
    setPin('ADMIN_PIN', undefined)
    setPin('SUPER_ADMIN_PIN', 'test-super-pin')

    expect(resolveAdminRole('test-super-pin')).toBe('super')
    expect(pinMatches('test-super-pin')).toBe(true)
  })

  it('при совпадении обоих PIN отдаёт super', () => {
    setPin('ADMIN_PIN', 'same-pin')
    setPin('SUPER_ADMIN_PIN', 'same-pin')

    expect(resolveAdminRole('same-pin')).toBe('super')
  })

  it('различает две роли', () => {
    setPin('ADMIN_PIN', 'abcd')
    setPin('SUPER_ADMIN_PIN', 'wxyz')

    expect(resolveAdminRole('abcd')).toBe('admin')
    expect(resolveAdminRole('wxyz')).toBe('super')
  })

  it('отвергает другое значение той же длины', () => {
    setPin('ADMIN_PIN', 'abcd')
    setPin('SUPER_ADMIN_PIN', undefined)

    expect(pinMatches('wxyz')).toBe(false)
  })

  it('отвергает значение другой длины', () => {
    setPin('ADMIN_PIN', 'abcd')
    setPin('SUPER_ADMIN_PIN', undefined)

    expect(pinMatches('ab')).toBe(false)
    expect(pinMatches('abcde')).toBe(false)
  })

  it('отвергает всё, пока оба PIN пусты', () => {
    setPin('ADMIN_PIN', undefined)
    setPin('SUPER_ADMIN_PIN', undefined)

    expect(pinMatches('abcd')).toBe(false)
    expect(pinMatches('')).toBe(false)
  })
})
