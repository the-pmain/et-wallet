/**
 * Mail-journal pages.
 *
 * Cloudflare returns a mixed list (GraphQL + KV). The cursor is an
 * opaque "created + id" mark so the next page takes older mail.
 */

export const MAILBOX_PAGE_DEFAULT = 20
export const MAILBOX_PAGE_MAX = 100
export const MAILBOX_FETCH_WINDOW = 1000

export interface IMailboxCursor {
  readonly createdAt: Date
  readonly id: string
}

export interface IMailboxPage<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}

export function parseMailboxLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return MAILBOX_PAGE_DEFAULT
  }

  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())

  if (!Number.isInteger(value) || value < 1) {
    return MAILBOX_PAGE_DEFAULT
  }

  return Math.min(value, MAILBOX_PAGE_MAX)
}

export function encodeMailboxCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\n${id}`, 'utf8').toString('base64url')
}

export function decodeMailboxCursor(cursor: string): IMailboxCursor | null {
  const trimmed = cursor.trim()

  if (trimmed === '') {
    return null
  }

  try {
    const raw = Buffer.from(trimmed, 'base64url').toString('utf8')
    const split = raw.indexOf('\n')

    if (split <= 0) {
      return null
    }

    const createdAt = new Date(raw.slice(0, split))
    const id = raw.slice(split + 1).trim()

    if (Number.isNaN(createdAt.getTime()) || id === '') {
      return null
    }

    return { createdAt, id }
  } catch {
    return null
  }
}

export function matchesMailboxPeer(
  record: { readonly from: string; readonly to: string },
  peer: string,
): boolean {
  const needle = peer.trim().toLowerCase()

  return record.from.trim().toLowerCase() === needle || record.to.trim().toLowerCase() === needle
}

export function paginateMailbox<
  T extends { readonly id: string; readonly createdAt: Date },
>(
  records: readonly T[],
  options: { readonly limit: number; readonly cursor: IMailboxCursor | null },
): IMailboxPage<T> {
  const sorted = [...records].sort(compareMailboxRecords)
  const cursor = options.cursor
  const afterCursor =
    cursor === null ? sorted : sorted.filter((record) => isOlderThanCursor(record, cursor))
  const items = afterCursor.slice(0, options.limit)
  const last = items[items.length - 1]
  const hasMore = afterCursor.length > items.length && last !== undefined

  return {
    items,
    nextCursor:
      hasMore && last !== undefined ? encodeMailboxCursor(last.createdAt, last.id) : null,
  }
}

function compareMailboxRecords(
  left: { readonly id: string; readonly createdAt: Date },
  right: { readonly id: string; readonly createdAt: Date },
): number {
  const byTime = right.createdAt.getTime() - left.createdAt.getTime()

  if (byTime !== 0) {
    return byTime
  }

  return right.id.localeCompare(left.id)
}

function isOlderThanCursor(
  record: { readonly id: string; readonly createdAt: Date },
  cursor: IMailboxCursor,
): boolean {
  const byTime = record.createdAt.getTime() - cursor.createdAt.getTime()

  if (byTime !== 0) {
    return byTime < 0
  }

  return record.id.localeCompare(cursor.id) < 0
}
