import { describe, expect, it } from 'vitest'

import { MemoryUsersRepository } from './MemoryUsersRepository.ts'

describe('MemoryUsersRepository', () => {
  it('записывает имя, баланс и the_p', async () => {
    const users = new MemoryUsersRepository()

    const record = await users.create({
      username: 'James',
      balance: '0',
      theP: 'demo',
    })

    expect(record.id).toBe('1')
    expect(record.username).toBe('James')
    expect(record.theP).toBe('demo')
    expect(users.records).toHaveLength(1)
  })
})
