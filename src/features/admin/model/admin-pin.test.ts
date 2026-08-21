import { afterEach, describe, expect, it } from 'vitest'

import { ADMIN_PIN_STORAGE_KEY, clearAdminPin, readAdminPin, writeAdminPin } from './admin-pin'

afterEach(() => {
  localStorage.clear()
})

describe('admin-pin', () => {
  it('записывает и читает PIN', () => {
    writeAdminPin('9100')

    expect(localStorage.getItem(ADMIN_PIN_STORAGE_KEY)).toBe('9100')
    expect(readAdminPin()).toBe('9100')
  })

  it('отвергает пустую запись', () => {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, '   ')
    expect(readAdminPin()).toBeNull()
  })

  it('стирает запись', () => {
    writeAdminPin('9100')
    clearAdminPin()
    expect(readAdminPin()).toBeNull()
  })
})
