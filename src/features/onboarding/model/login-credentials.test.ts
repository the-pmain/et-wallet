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
  it('записывает id, email и the_p', () => {
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

  it('читает прежнюю запись с ключом username, если есть id', () => {
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

  it('отвергает запись без id', () => {
    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ email: 'james@example.com', the_p: '123456' }),
    )

    expect(readLoginCredentials()).toBeNull()
  })

  it('отвергает повреждённую запись', () => {
    localStorage.setItem(LOGIN_CREDENTIALS_STORAGE_KEY, '{')
    expect(readLoginCredentials()).toBeNull()

    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ id: '7', email: 'james@example.com' }),
    )
    expect(readLoginCredentials()).toBeNull()
  })

  it('стирает запись', () => {
    writeLoginCredentials({ id: '7', email: 'james@example.com', theP: '123456' })
    clearLoginCredentials()
    expect(readLoginCredentials()).toBeNull()
  })
})
