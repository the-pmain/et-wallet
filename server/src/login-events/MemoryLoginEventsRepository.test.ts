import { describe, expect, it } from 'vitest'

import { MemoryLoginEventsRepository } from './MemoryLoginEventsRepository.ts'

describe('MemoryLoginEventsRepository', () => {
  it('stores a login and lists newest first', async () => {
    const events = new MemoryLoginEventsRepository()

    const first = await events.create({ userId: '7' })
    const second = await events.create({ userId: '7' })
    await events.create({ userId: '8' })

    const listed = await events.list()
    const forUser = await events.listByUserId('7')

    expect(listed.map((entry) => entry.userId)).toEqual(['8', '7', '7'])
    expect(listed).toHaveLength(3)
    expect(forUser.map((entry) => entry.id)).toEqual([second.id, first.id])
    expect(forUser.every((entry) => entry.userId === '7')).toBe(true)
  })
})
