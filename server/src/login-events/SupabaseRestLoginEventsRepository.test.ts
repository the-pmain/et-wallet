import { describe, expect, it, vi } from 'vitest'

import { ServiceUnavailableError } from '../lib/errors.ts'

import {
  isMissingLoginEventsTableError,
  LoginEventsDatabaseError,
  SupabaseRestLoginEventsRepository,
} from './SupabaseRestLoginEventsRepository.ts'

const CREATED_ROW = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  created_at: '2026-09-08T12:04:21.000Z',
  user_id: '7',
  time_zone: 'Europe/London',
  city: 'London',
  region: 'England',
  country: 'United Kingdom',
  country_code: 'GB',
}

describe('SupabaseRestLoginEventsRepository', () => {
  it('writes user_id and returns the stored row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify([CREATED_ROW])),
    })
    const events = new SupabaseRestLoginEventsRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const record = await events.create({
      userId: '7',
      timeZone: 'Europe/London',
      city: 'London',
      region: 'England',
      country: 'United Kingdom',
      countryCode: 'GB',
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://example.supabase.co/rest/v1/login_events',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        apikey: 'service-role',
        authorization: 'Bearer service-role',
        prefer: 'return=representation',
      }),
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      user_id: '7',
      time_zone: 'Europe/London',
      city: 'London',
      region: 'England',
      country: 'United Kingdom',
      country_code: 'GB',
    })
    expect(record).toMatchObject({
      id: CREATED_ROW.id,
      userId: '7',
      city: 'London',
      country: 'United Kingdom',
      countryCode: 'GB',
      region: 'England',
      timeZone: 'Europe/London',
    })
    expect(record.createdAt.toISOString()).toBe(CREATED_ROW.created_at)
  })

  it('lists events newest first', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify([CREATED_ROW])),
    })
    const events = new SupabaseRestLoginEventsRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    const listed = await events.list({ limit: 50 })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('order=created_at.desc')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=50')
    expect(listed[0]?.userId).toBe('7')
    expect(listed[0]?.city).toBe('London')
  })

  it('marks a missing table so startup can fall back to memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            code: 'PGRST205',
            message: "Could not find the table 'public.login_events' in the schema cache",
          }),
        ),
    })
    const events = new SupabaseRestLoginEventsRepository({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: fetchMock as unknown as typeof fetch,
    })

    await expect(events.listByUserId('0', { limit: 1 })).rejects.toBeInstanceOf(
      LoginEventsDatabaseError,
    )
    await expect(events.listByUserId('0', { limit: 1 })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    )

    try {
      await events.listByUserId('0', { limit: 1 })
    } catch (error) {
      expect(error).toBeInstanceOf(LoginEventsDatabaseError)
      expect((error as LoginEventsDatabaseError).isMissingTable).toBe(true)
    }
  })

  it('recognises the missing-table message', () => {
    expect(isMissingLoginEventsTableError("Could not find the table 'public.login_events'")).toBe(
      true,
    )
    expect(isMissingLoginEventsTableError('PGRST205')).toBe(true)
  })
})
