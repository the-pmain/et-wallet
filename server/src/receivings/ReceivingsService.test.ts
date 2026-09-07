import { describe, expect, it } from 'vitest'

import { SENDING_STATUS } from '../sendings/status.ts'
import { ASSET_STANDARD } from '../users/assets.ts'
import { MemoryUsersRepository } from '../users/MemoryUsersRepository.ts'

import { MemoryReceivingsRepository } from './MemoryReceivingsRepository.ts'
import { ReceivingsService } from './ReceivingsService.ts'

describe('ReceivingsService', () => {
  it('creates a pending receiving without changing the holding', async () => {
    const { service, users } = await setup()

    const record = await service.register({
      userId: '1',
      status: SENDING_STATUS.Pending,
      amount: '3',
      symbol: 'ETH',
      usdAmount: '9852.36',
    })

    expect(record.status).toBe(SENDING_STATUS.Pending)
    expect(record.amount).toBe('3')
    expect(record.usdAmount).toBe('9852.36')

    const user = await users.findById('1')
    expect(user?.assets.tokens[0]?.balance).toBe('2000000000000000000')
  })

  it('sets the holding when the receiving succeeds', async () => {
    const { service, users } = await setup()

    await service.register({
      userId: '1',
      status: SENDING_STATUS.Success,
      amount: '3',
      symbol: 'ETH',
    })

    const user = await users.findById('1')
    expect(user?.assets.tokens[0]?.balance).toBe('3000000000000000000')
  })

  it('records an unknown ticker without changing holdings', async () => {
    const { service, users } = await setup()

    const record = await service.register({
      userId: '1',
      status: SENDING_STATUS.Success,
      amount: '12',
      symbol: 'SOL',
    })

    expect(record.symbol).toBe('SOL')
    expect(record.status).toBe(SENDING_STATUS.Success)

    const user = await users.findById('1')
    expect(user?.assets.tokens[0]?.balance).toBe('2000000000000000000')
  })

  it('applies the holding when a pending receiving is marked success', async () => {
    const { service, users } = await setup()

    const created = await service.register({
      userId: '1',
      status: SENDING_STATUS.Pending,
      amount: '1.5',
      symbol: 'ETH',
    })

    await service.update(created.id, {
      status: SENDING_STATUS.Success,
      failureMessage: null,
      amount: '1.5',
      symbol: 'ETH',
    })

    const user = await users.findById('1')
    expect(user?.assets.tokens[0]?.balance).toBe('1500000000000000000')
  })
})

async function setup() {
  const users = new MemoryUsersRepository()
  const receivings = new MemoryReceivingsRepository()

  await users.create({
    email: 'james@example.com',
    balance: '0',
    theP: 'secret',
    assets: {
      quoteCurrency: 'USD',
      updatedAt: '2026-08-20T12:00:00.000Z',
      tokens: [
        {
          chainId: '1',
          standard: ASSET_STANDARD.Native,
          address: null,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          balance: '2000000000000000000',
          isVerified: true,
        },
      ],
    },
  })

  return { service: new ReceivingsService(receivings, users), users }
}
