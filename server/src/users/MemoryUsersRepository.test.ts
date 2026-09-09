import { describe, expect, it } from 'vitest'

import { MemoryUsersRepository } from './MemoryUsersRepository.ts'
import { emptyAssets } from './assets.ts'
import { WALLET_CODENAME_RECEIVING_FUNDS } from './wallets.ts'

describe('MemoryUsersRepository', () => {
  it('writes email, balance and the_p', async () => {
    const users = new MemoryUsersRepository()

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
    })

    expect(record.id).toBe('1')
    expect(record.email).toBe('james@example.com')
    expect(record.theP).toBe('demo')
    expect(record.wallets).toEqual({})
    expect(record.assets).toEqual(emptyAssets())
    expect(record.seedPhrase).toBeNull()
    expect(users.records).toHaveLength(1)
  })

  it('accepts wallets on create', async () => {
    const users = new MemoryUsersRepository()
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '0' },
      },
    })

    expect(record.wallets).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '0' },
    })
  })

  it('accepts seed_phrase on create', async () => {
    const users = new MemoryUsersRepository()
    const seedPhrase =
      'abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,abandon,about'

    const record = await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      seedPhrase,
    })

    expect(record.seedPhrase).toBe(seedPhrase)
  })

  it('finds a record by id', async () => {
    const users = new MemoryUsersRepository()

    await users.create({ email: 'james@example.com', balance: '10', theP: 'demo' })
    const found = await users.findById('1')

    expect(found?.email).toBe('james@example.com')
    expect(await users.findById('99')).toBeNull()
  })

  it('finds a record only when email and the_p match', async () => {
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

  it('adds an address to wallets of the found record', async () => {
    const users = new MemoryUsersRepository()
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    await users.create({ email: 'james@example.com', balance: '0', theP: 'demo' })
    const updated = await users.addWallet({
      email: 'james@example.com',
      theP: 'demo',
      codename: WALLET_CODENAME_RECEIVING_FUNDS,
      key,
      value: '0',
    })

    expect(updated?.wallets).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '0' },
    })
    expect(users.records[0]?.wallets).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '0' },
    })
    expect(updated?.assets).toEqual(emptyAssets())
    expect(
      await users.addWallet({
        email: 'james@example.com',
        theP: 'wrong',
        codename: WALLET_CODENAME_RECEIVING_FUNDS,
        key,
        value: 'Nope',
      }),
    ).toBeNull()
  })

  it('returns every record as a list', async () => {
    const users = new MemoryUsersRepository()

    await users.create({ email: 'james@example.com', balance: '1', theP: 'a' })
    await users.create({ email: 'maria@example.com', balance: '2', theP: 'b' })

    const listed = await users.list()

    expect(listed.map((entry) => entry.email)).toEqual(['james@example.com', 'maria@example.com'])
  })

  it('changes balance and wallet value by id', async () => {
    const users = new MemoryUsersRepository()
    const key = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    await users.create({
      email: 'james@example.com',
      balance: '0',
      theP: 'demo',
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '0' },
      },
    })

    const updated = await users.update('1', {
      balance: '12.5',
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '2500' },
      },
    })

    expect(updated?.balance).toBe('12.5')
    expect(updated?.wallets).toEqual({
      [WALLET_CODENAME_RECEIVING_FUNDS]: { key, value: '2500' },
    })
    expect(updated?.email).toBe('james@example.com')
    expect(await users.update('99', { balance: '1' })).toBeNull()
  })

  it('deletes a record by id', async () => {
    const users = new MemoryUsersRepository()

    await users.create({ email: 'james@example.com', balance: '0', theP: 'demo' })

    expect(await users.remove('1')).toBe(true)
    expect(await users.list()).toEqual([])
    expect(await users.remove('1')).toBe(false)
  })
})
