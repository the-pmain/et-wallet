import { afterEach, describe, expect, it } from 'vitest'

import {
  EMAIL_MANAGER_PIN_STORAGE_KEY,
  clearEmailManagerPin,
  readEmailManagerPin,
  writeEmailManagerPin,
} from './email-manager-pin'

afterEach(() => {
  localStorage.clear()
})

describe('email-manager-pin', () => {
  it('записывает и читает PIN в своём ключе', () => {
    writeEmailManagerPin('3100')

    expect(localStorage.getItem(EMAIL_MANAGER_PIN_STORAGE_KEY)).toBe('3100')
    expect(readEmailManagerPin()).toBe('3100')
    expect(localStorage.getItem('etwallet.admin-pin')).toBeNull()
  })

  it('отвергает пустую запись', () => {
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, '   ')
    expect(readEmailManagerPin()).toBeNull()
  })

  it('стирает запись', () => {
    writeEmailManagerPin('3100')
    clearEmailManagerPin()
    expect(readEmailManagerPin()).toBeNull()
  })
})
