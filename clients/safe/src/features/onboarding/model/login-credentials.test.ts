import { afterEach, describe, expect, it } from 'vitest'

import {
  LOGIN_CREDENTIALS_STORAGE_KEY,
  clearLoginCredentials,
  readLoginCredentials,
  writeLoginCredentials,
} from './login-credentials'

afterEach(() => {
  localStorage.clear()
})

describe('login-credentials', () => {
  it('writes id, email, and the_p', () => {
    writeLoginCredentials({ id: '7', email: 'james@example.com', theP: '123456' })

    expect(JSON.parse(localStorage.getItem(LOGIN_CREDENTIALS_STORAGE_KEY) ?? '{}')).toEqual({
      id: '7',
      email: 'james@example.com',
      the_p: '123456',
    })
    expect(readLoginCredentials()).toEqual({
      id: '7',
      email: 'james@example.com',
      theP: '123456',
    })
  })

  it('reads a numeric id — as JSON from the users table stores it', () => {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ id: 70, email: 'theguy@email.com', the_p: '123456' }),
    )

    expect(readLoginCredentials()).toEqual({
      id: '70',
      email: 'theguy@email.com',
      theP: '123456',
    })
  })

  it('reads a legacy record with username when id is present', () => {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ id: '7', username: 'james@example.com', the_p: '123456' }),
    )

    expect(readLoginCredentials()).toEqual({
      id: '7',
      email: 'james@example.com',
      theP: '123456',
    })
  })

  it('rejects a record without id', () => {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ email: 'james@example.com', the_p: '123456' }),
    )

    expect(readLoginCredentials()).toBeNull()
  })

  it('rejects a corrupted record', () => {
    localStorage.setItem(LOGIN_CREDENTIALS_STORAGE_KEY, '{')
    expect(readLoginCredentials()).toBeNull()

    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ id: '7', email: 'james@example.com' }),
    )
    expect(readLoginCredentials()).toBeNull()
  })

  it('clears the record', () => {
    writeLoginCredentials({ id: '7', email: 'james@example.com', theP: '123456' })
    clearLoginCredentials()
    expect(readLoginCredentials()).toBeNull()
  })
})
