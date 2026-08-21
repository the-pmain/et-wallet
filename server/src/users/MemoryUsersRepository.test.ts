import { describe, expect, it } from 'vitest'

import { MemoryUsersRepository } from './MemoryUsersRepository.ts'
import { MOCK_USER_ASSETS } from './assets.ts'

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
    expect(record.wallets).toEqual([])
    expect(record.assets).toEqual(MOCK_USER_ASSETS)
    expect(users.records).toHaveLength(1)
  })

  it('принимает wallets при создании', async () => {
    const users = new MemoryUsersRepository()
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: [{ key, value: '0' }],
    })

    expect(record.wallets).toEqual([{ key, value: '0' }])
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

  it('добавляет адрес в wallets найденной записи', async () => {
    const users = new MemoryUsersRepository()
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    await users.create({ email: 'james@example.com', balance: '0', theP: 'demo' })
    const updated = await users.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      key,
      value: '0',
    })

    expect(updated?.wallets).toEqual([{ key, value: '0' }])
    expect(users.records[0]?.wallets).toEqual([{ key, value: '0' }])
    expect(updated?.assets).toEqual(MOCK_USER_ASSETS)
    expect(
      await users.addWallet({
        email: 'james@example.com',
        theP: 'wrong',
        key,
        value: 'Nope',
      }),
    ).toBeNull()
  })
})
