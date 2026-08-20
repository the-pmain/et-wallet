import { describe, expect, it } from 'vitest'

import { MemoryUsersRepository } from './MemoryUsersRepository.ts'

describe('MemoryUsersRepository', () => {
  it('записывает почту, баланс и the_p', async () => {
    const users = new MemoryUsersRepository()

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
    })

    expect(record.id).toBe('1')
    expect(record.email).toBe('james@example.com')
    expect(record.theP).toBe('demo')
    expect(users.records).toHaveLength(1)
  })

  it('находит запись по id', async () => {
    const users = new MemoryUsersRepository()

    await users.create({ email: 'james@example.com', balance: '10', theP: 'demo' })
    const found = await users.findById('1')

    expect(found?.email).toBe('james@example.com')
    expect(await users.findById('99')).toBeNull()
  })

  it('находит запись только при совпадении почты и the_p', async () => {
    const users = new MemoryUsersRepository()

    await users.create({ email: 'james@example.com', balance: '10', theP: 'demo' })
    await users.create({ email: 'maria@example.com', balance: '3', theP: 'demo' })

    const found = await users.findByCredentials({ email: 'james@example.com', theP: 'demo' })

    expect(found?.email).toBe('james@example.com')
    expect(found?.balance).toBe('10')
    expect(await users.findByCredentials({ email: 'james@example.com', theP: 'other' })).toBeNull()
    expect(
      await users.findByCredentials({ email: 'maria@example.com', theP: 'missing' }),
    ).toBeNull()
  })
})
