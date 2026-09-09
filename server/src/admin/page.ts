/**
 * Shared cabinet list page.
 *
 * Offset pages, not cursors: the admin needs "page 2 of N" and a
 * total. Query fields arrive as strings (`coerceTypes` is off).
 */

export const ADMIN_PAGE_SIZE = 20
export const ADMIN_PAGE_SIZE_MAX = 100
export const ADMIN_DIRECTORY_SCAN_LIMIT = 2000
/** Joined scans stay in process this long, or until a write invalidates them. */
export const ADMIN_DIRECTORY_CACHE_TTL_MS = 15_000

export interface IAdminPageQuery {
  readonly page: number
  readonly pageSize: number
  readonly q: string
  readonly status?: 'pending'
}

export interface IAdminPage<T> {
  readonly items: readonly T[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export function readAdminPageQuery(query: {
  readonly page?: string
  readonly pageSize?: string
  readonly q?: string
  readonly status?: string
}): IAdminPageQuery {
  const pageSize = clamp(
    readPositiveInt(query.pageSize, ADMIN_PAGE_SIZE),
    1,
    ADMIN_PAGE_SIZE_MAX,
  )
  const page = readPositiveInt(query.page, 1)
  const q = (query.q ?? '').trim()
  const status = query.status === 'pending' ? 'pending' : undefined

  if (status === undefined) {
    return { page, pageSize, q }
  }

  return { page, pageSize, q, status }
}

export function sliceAdminPage<T>(
  items: readonly T[],
  query: IAdminPageQuery,
): IAdminPage<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const start = (page - 1) * query.pageSize

  return {
    items: items.slice(start, start + query.pageSize),
    page,
    pageSize: query.pageSize,
    total,
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback
  }

  if (!/^[0-9]+$/u.test(value)) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
