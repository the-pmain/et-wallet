import { describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '../lib/errors.ts'

import {
  isBrokenSendingsIdFkError,
  SupabaseRestSendingsRepository,
} from './SupabaseRestSendingsRepository.ts'
import { SENDING_STATUS } from './status.ts'

const CREATED_ROW = {
  id: 72,
  created_at: '2026-08-22T13:19:59.797Z',
  user_id: '72',
  status: 'pending',
  failure_message: null,
  recipient_address: '0xBB010AAb37E5b891DD2246de894E86C323EaB66E',
  amount: '0.01',
  asset_symbol: 'ETH',
}

const FK_ERROR = {
  ok: false,
  status: 409,
  text: () =>
    Promise.resolve(
      JSON.stringify({
        code: '23503',
        details: 'Key (id)=(18) is not present in table "users".',
        message:
          'insert or update on table "sendings" violates foreign key constraint "sendings_id_fkey"',
      }),
    ),
}

describe('SupabaseRestSendingsRepository', () => {
  it('writes user_id, status, recipient_address and amount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify([CREATED_ROW])),
    })
    const sendings = new SupabaseRestSendingsRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await sendings.create({
      userId: '72',
      status: SENDING_STATUS.Pending,
      recipientAddress: CREATED_ROW.recipient_address,
      amount: CREATED_ROW.amount,
      symbol: 'ETH',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: '72',
      status: 'pending',
      failure_message: null,
      recipient_address: CREATED_ROW.recipient_address,
      amount: '0.01',
      asset_symbol: 'ETH',
    })
    expect(record).toMatchObject({
      id: '72',
      userId: '72',
      status: 'pending',
      amount: '0.01',
      symbol: 'ETH',
    })
  })

  it('retries with id = user_id when sendings_id_fkey rejects identity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(FK_ERROR)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([CREATED_ROW])),
      })
    const sendings = new SupabaseRestSendingsRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await sendings.create({
      userId: '72',
      status: SENDING_STATUS.Pending,
      recipientAddress: CREATED_ROW.recipient_address,
      amount: CREATED_ROW.amount,
      symbol: 'ETH',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: '72',
      status: 'pending',
      failure_message: null,
      recipient_address: CREATED_ROW.recipient_address,
      amount: '0.01',
      asset_symbol: 'ETH',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      id: 72,
      user_id: '72',
    })
    expect(record.id).toBe('72')
    expect(record.userId).toBe('72')
  })

  it('uses an unused users.id when the preferred sending id is taken', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(FK_ERROR)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: '23505',
              details: 'Key (id)=(72) already exists.',
              message: 'duplicate key value violates unique constraint "sendings_pkey"',
            }),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([{ id: 72 }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify([{ id: 60 }, { id: 72 }])),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                ...CREATED_ROW,
                id: 60,
                user_id: '72',
              },
            ]),
          ),
      })
    const sendings = new SupabaseRestSendingsRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await sendings.create({
      userId: '72',
      status: SENDING_STATUS.Pending,
      recipientAddress: CREATED_ROW.recipient_address,
      amount: CREATED_ROW.amount,
      symbol: 'ETH',
    })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toMatchObject({
      id: 60,
      user_id: '72',
    })
    expect(record.id).toBe('60')
    expect(record.userId).toBe('72')
  })

  it('does not retry unrelated insert errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"message":"Invalid API key"}'),
    })
    const sendings = new SupabaseRestSendingsRepository({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(
      sendings.create({
        userId: '72',
        status: SENDING_STATUS.Pending,
        recipientAddress: CREATED_ROW.recipient_address,
        amount: CREATED_ROW.amount,
        symbol: 'ETH',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('treats sendings_pkey collisions as the broken id=user_id schema', () => {
    expect(
      isBrokenSendingsIdFkError(
        'Supabase responded with 409: {"code":"23505","details":"Key (id)=(70) already exists.","message":"duplicate key value violates unique constraint \\"sendings_pkey\\""}',
      ),
    ).toBe(true)
    expect(isBrokenSendingsIdFkError('{"message":"Invalid API key"}')).toBe(false)
  })
})
