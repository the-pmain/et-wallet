import {
  parseRemoteReceiving,
  parseRemoteSending,
  type IRemoteReceiving,
  type IRemoteSending,
} from '@/features/onboarding'

export const ADMIN_PAGE_SIZE = 20

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

export interface IAdminDirectorySending extends IRemoteSending {
  readonly userEmail: string | null
}

export interface IAdminDirectoryReceiving extends IRemoteReceiving {
  readonly userEmail: string | null
}

export function adminPageSearch(query: IAdminPageQuery): string {
  const params = new URLSearchParams()

  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))

  const q = query.q.trim()

  if (q !== '') {
    params.set('q', q)
  }

  if (query.status === 'pending') {
    params.set('status', 'pending')
  }

  return `?${params.toString()}`
}

export function parseAdminPage<T>(
  payload: unknown,
  parseItem: (item: unknown) => T | null,
): IAdminPage<T> | null {
  if (payload === null || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const items = record['items']
  const page = record['page']
  const pageSize = record['pageSize']
  const total = record['total']

  if (!Array.isArray(items)) {
    return null
  }

  if (!isPageInt(page) || !isPageInt(pageSize) || !isPageInt(total)) {
    return null
  }

  const parsed: T[] = []

  for (const item of items) {
    const row = parseItem(item)

    if (row === null) {
      return null
    }

    parsed.push(row)
  }

  return {
    items: parsed,
    page,
    pageSize,
    total,
  }
}

export function parseAdminDirectorySending(payload: unknown): IAdminDirectorySending | null {
  const sending = parseRemoteSending(payload)

  if (sending === null) {
    return null
  }

  const userEmail = readJoinedEmail(payload)

  if (userEmail === undefined) {
    return null
  }

  return { ...sending, userEmail }
}

export function parseAdminDirectoryReceiving(payload: unknown): IAdminDirectoryReceiving | null {
  const receiving = parseRemoteReceiving(payload)

  if (receiving === null) {
    return null
  }

  const userEmail = readJoinedEmail(payload)

  if (userEmail === undefined) {
    return null
  }

  return { ...receiving, userEmail }
}

export function emptyAdminPage<T>(pageSize: number = ADMIN_PAGE_SIZE): IAdminPage<T> {
  return {
    items: [],
    page: 1,
    pageSize,
    total: 0,
  }
}

function readJoinedEmail(payload: unknown): string | null | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined
  }

  const userEmail = (payload as Record<string, unknown>)['userEmail']

  if (userEmail === null) {
    return null
  }

  if (typeof userEmail !== 'string') {
    return undefined
  }

  return userEmail === '' ? null : userEmail
}

function isPageInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
