import { describe, expect, it } from 'vitest'

import {
  decodeMailboxCursor,
  encodeMailboxCursor,
  MAILBOX_PAGE_DEFAULT,
  matchesMailboxPeer,
  paginateMailbox,
  parseMailboxLimit,
} from './paginate.ts'

function record(id: string, createdAt: string, from = 'a@example.com', to = 'b@example.com') {
  return { id, createdAt: new Date(createdAt), from, to }
}

describe('paginateMailbox', () => {
  it('applies the default limit', () => {
    expect(parseMailboxLimit(undefined)).toBe(MAILBOX_PAGE_DEFAULT)
    expect(parseMailboxLimit('3')).toBe(3)
    expect(parseMailboxLimit(1000)).toBe(100)
  })

  it('slices the list by cursor', () => {
    const records = [
      record('3', '2026-08-27T12:00:00.000Z'),
      record('2', '2026-08-27T11:00:00.000Z'),
      record('1', '2026-08-27T10:00:00.000Z'),
    ]

    const first = paginateMailbox(records, { limit: 2, cursor: null })

    expect(first.items.map((item) => item.id)).toEqual(['3', '2'])
    expect(first.nextCursor).not.toBeNull()

    const cursor = decodeMailboxCursor(first.nextCursor ?? '')

    expect(cursor).not.toBeNull()

    const second = paginateMailbox(records, { limit: 2, cursor })

    expect(second.items.map((item) => item.id)).toEqual(['1'])
    expect(second.nextCursor).toBeNull()
  })

  it('encodes a cursor both ways', () => {
    const createdAt = new Date('2026-08-27T12:00:00.000Z')
    const encoded = encodeMailboxCursor(createdAt, 'msg-1')

    expect(decodeMailboxCursor(encoded)).toEqual({ createdAt, id: 'msg-1' })
  })

  it('filters mail of a counterpart', () => {
    expect(
      matchesMailboxPeer(
        { from: 'User@Example.com', to: 'support@etwalletx.com' },
        'user@example.com',
      ),
    ).toBe(true)
    expect(
      matchesMailboxPeer(
        { from: 'support@etwalletx.com', to: 'user@example.com' },
        'user@example.com',
      ),
    ).toBe(true)
    expect(
      matchesMailboxPeer(
        { from: 'other@example.com', to: 'support@etwalletx.com' },
        'user@example.com',
      ),
    ).toBe(false)
  })
})
