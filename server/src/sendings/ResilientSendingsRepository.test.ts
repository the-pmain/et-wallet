import { describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '../lib/errors.ts'

import { MemorySendingsRepository } from './MemorySendingsRepository.ts'
import { ResilientSendingsRepository } from './ResilientSendingsRepository.ts'
import { SENDING_STATUS } from './status.ts'

describe('ResilientSendingsRepository', () => {
  it('falls back to memory when Supabase rejects insert with sendings_id_fkey', async () => {
    const onFallback = vi.fn()
    const primary = new MemorySendingsRepository()
    const brokenCreate = vi.spyOn(primary, 'create').mockRejectedValueOnce(
      new ServiceUnavailableError(
        'Supabase responded with 409: {"code":"23503","message":"insert or update on table \\"sendings\\" violates foreign key constraint \\"sendings_id_fkey\\""}',
      ),
    )

    const repository = new ResilientSendingsRepository(primary, onFallback)
    const record = await repository.create({
      userId: '70',
      status: SENDING_STATUS.Pending,
      recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: '2',
      symbol: 'ETH',
    })

    expect(onFallback).toHaveBeenCalledOnce()
    expect(brokenCreate).toHaveBeenCalledOnce()
    expect(record.userId).toBe('70')
    expect(record.amount).toBe('2')
  })

  it('falls back to memory when identity collides with sendings_pkey', async () => {
    const onFallback = vi.fn()
    const primary = new MemorySendingsRepository()
    vi.spyOn(primary, 'create').mockRejectedValueOnce(
      new ServiceUnavailableError(
        'Supabase responded with 409: {"code":"23505","details":"Key (id)=(70) already exists.","message":"duplicate key value violates unique constraint \\"sendings_pkey\\""}',
      ),
    )

    const repository = new ResilientSendingsRepository(primary, onFallback)
    const record = await repository.create({
      userId: '70',
      status: SENDING_STATUS.Pending,
      recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amount: '2',
      symbol: 'ETH',
    })

    expect(onFallback).toHaveBeenCalledOnce()
    expect(record.userId).toBe('70')
    expect(record.amount).toBe('2')
  })
})
