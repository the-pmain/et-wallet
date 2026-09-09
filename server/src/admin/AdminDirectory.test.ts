import { describe, expect, it, vi } from 'vitest'

import { SENDING_SSE_TYPE } from '../api/contracts.ts'
import { MemoryLoginEventsRepository } from '../login-events/MemoryLoginEventsRepository.ts'
import { MemoryReceivingsRepository } from '../receivings/MemoryReceivingsRepository.ts'
import { ReceivingsService } from '../receivings/ReceivingsService.ts'
import { MemorySendingsRepository } from '../sendings/MemorySendingsRepository.ts'
import { SendingsHub } from '../sendings/SendingsHub.ts'
import { SendingsService } from '../sendings/SendingsService.ts'
import { SENDING_STATUS } from '../sendings/status.ts'
import { MemoryUsersRepository } from '../users/MemoryUsersRepository.ts'

import { AdminDirectory } from './AdminDirectory.ts'
import { ADMIN_PAGE_SIZE } from './page.ts'

const RECIPIENT = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

describe('AdminDirectory', () => {
  it('joins user emails onto a sendings page', async () => {
    const { directory, leo } = await seedSendings()
    const page = await directory.listSendings({ page: 1, pageSize: 20, q: '' })

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      amount: '2',
      symbol: 'ETH',
      userId: leo,
      userEmail: 'leo@example.com',
      recipientAddress: RECIPIENT,
    })
  })

  it('searches sendings by email', async () => {
    const { directory } = await seedSendings()
    const found = await directory.listSendings({ page: 1, pageSize: 20, q: 'leo@' })
    const missed = await directory.listSendings({ page: 1, pageSize: 20, q: 'maria@' })

    expect(found.total).toBe(1)
    expect(found.items[0]?.userEmail).toBe('leo@example.com')
    expect(missed.total).toBe(0)
  })

  it('joins emails onto receivings and finds by usd amount', async () => {
    const { directory, james } = await seedReceivings()
    const page = await directory.listReceivings({ page: 1, pageSize: 20, q: '999.87' })

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      userId: james,
      userEmail: 'james@example.com',
      usdAmount: '999.87',
      symbol: 'USDT',
    })
  })

  it('pages users and activity after search', async () => {
    const users = new MemoryUsersRepository()
    const loginEvents = new MemoryLoginEventsRepository()
    const first = await users.create({ email: 'james@example.com', balance: '1', theP: 'a' })
    await users.create({ email: 'maria@example.com', balance: '0', theP: 'b' })
    await loginEvents.create({
      userId: first.id,
      city: 'London',
      country: 'United Kingdom',
      countryCode: 'GB',
    })

    const directory = new AdminDirectory({
      users,
      sendings: new SendingsService(new MemorySendingsRepository(), users),
      receivings: new ReceivingsService(new MemoryReceivingsRepository(), users),
      loginEvents,
    })

    const userPage = await directory.listUsers({ page: 1, pageSize: 1, q: '' })
    const byId = await directory.listUsers({
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
      q: first.id,
    })
    const activity = await directory.listActivity({ page: 1, pageSize: 20, q: 'london' })

    expect(userPage.total).toBe(2)
    expect(userPage.items).toHaveLength(1)
    expect(byId.total).toBe(1)
    expect(activity.total).toBe(1)
    expect(activity.items[0]?.email).toBe('james@example.com')
  })

  it('reuses the sendings scan and identities while the cache holds', async () => {
    const users = new MemoryUsersRepository()
    const sendings = new MemorySendingsRepository()
    const leo = (await users.create({ email: 'leo@example.com', balance: '0', theP: 'leo' })).id

    await sendings.create({
      userId: leo,
      recipientAddress: RECIPIENT,
      amount: '2',
      symbol: 'ETH',
    })

    const listIdentities = vi.spyOn(users, 'listIdentities')
    const listSendings = vi.spyOn(sendings, 'list')
    const directory = new AdminDirectory({
      users,
      sendings: new SendingsService(sendings, users),
      receivings: new ReceivingsService(new MemoryReceivingsRepository(), users),
      loginEvents: new MemoryLoginEventsRepository(),
    })

    await Promise.all([
      directory.listSendings({ page: 1, pageSize: 20, q: '' }),
      directory.listSendings({ page: 1, pageSize: 20, q: '' }),
    ])
    const pending = await directory.listSendings({
      page: 1,
      pageSize: 20,
      q: '',
      status: 'pending',
    })
    const secondPage = await directory.listSendings({ page: 2, pageSize: 20, q: '' })

    expect(listIdentities).toHaveBeenCalledTimes(1)
    expect(listSendings).toHaveBeenCalledTimes(1)
    expect(pending.total).toBe(1)
    expect(secondPage.total).toBe(1)
  })

  it('reloads sendings after the hub publishes a write', async () => {
    const users = new MemoryUsersRepository()
    const sendings = new MemorySendingsRepository()
    const hub = new SendingsHub()
    const leo = (await users.create({ email: 'leo@example.com', balance: '0', theP: 'leo' })).id
    const listSendings = vi.spyOn(sendings, 'list')

    await sendings.create({
      userId: leo,
      recipientAddress: RECIPIENT,
      amount: '2',
      symbol: 'ETH',
    })

    const directory = new AdminDirectory({
      users,
      sendings: new SendingsService(sendings, users),
      receivings: new ReceivingsService(new MemoryReceivingsRepository(), users),
      loginEvents: new MemoryLoginEventsRepository(),
      sendingsHub: hub,
    })

    await directory.listSendings({ page: 1, pageSize: 20, q: '' })
    hub.publish({
      id: '1',
      createdAt: '2026-09-09T12:00:00.000Z',
      userId: leo,
      status: SENDING_STATUS.Pending,
      failureMessage: null,
      recipientAddress: RECIPIENT,
      amount: '2',
      symbol: 'ETH',
      type_send: SENDING_SSE_TYPE.Create,
    })
    await directory.listSendings({ page: 1, pageSize: 20, q: '' })

    expect(listSendings).toHaveBeenCalledTimes(2)
  })
})

async function seedSendings(): Promise<{
  readonly directory: AdminDirectory
  readonly leo: string
}> {
  const users = new MemoryUsersRepository()
  const sendings = new MemorySendingsRepository()
  const leo = (await users.create({ email: 'leo@example.com', balance: '0', theP: 'leo' })).id

  await sendings.create({
    userId: leo,
    recipientAddress: RECIPIENT,
    amount: '2',
    symbol: 'ETH',
  })

  return {
    directory: new AdminDirectory({
      users,
      sendings: new SendingsService(sendings, users),
      receivings: new ReceivingsService(new MemoryReceivingsRepository(), users),
      loginEvents: new MemoryLoginEventsRepository(),
    }),
    leo,
  }
}

async function seedReceivings(): Promise<{
  readonly directory: AdminDirectory
  readonly james: string
}> {
  const users = new MemoryUsersRepository()
  const receivings = new MemoryReceivingsRepository()
  const james = (await users.create({ email: 'james@example.com', balance: '0', theP: 'james' }))
    .id

  await receivings.create({
    userId: james,
    status: SENDING_STATUS.Success,
    recipientAddress: RECIPIENT,
    amount: '1000',
    symbol: 'USDT',
    usdAmount: '999.87',
  })

  return {
    directory: new AdminDirectory({
      users,
      sendings: new SendingsService(new MemorySendingsRepository(), users),
      receivings: new ReceivingsService(receivings, users),
      loginEvents: new MemoryLoginEventsRepository(),
    }),
    james,
  }
}
