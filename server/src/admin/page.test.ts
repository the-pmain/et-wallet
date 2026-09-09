import { describe, expect, it } from 'vitest'

import { ADMIN_PAGE_SIZE, readAdminPageQuery, sliceAdminPage } from './page.ts'

describe('readAdminPageQuery', () => {
  it('uses the default page and size', () => {
    expect(readAdminPageQuery({})).toEqual({
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
      q: '',
    })
  })

  it('reads page, size, and a trimmed query', () => {
    expect(readAdminPageQuery({ page: '3', pageSize: '10', q: '  leo@  ' })).toEqual({
      page: 3,
      pageSize: 10,
      q: 'leo@',
    })
  })

  it('keeps a pending status filter and drops anything else', () => {
    expect(readAdminPageQuery({ status: 'pending' }).status).toBe('pending')
    expect(readAdminPageQuery({ status: 'success' })).toEqual({
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
      q: '',
    })
  })

  it('caps page size and ignores junk', () => {
    expect(readAdminPageQuery({ page: '0', pageSize: '999' }).pageSize).toBe(100)
    expect(readAdminPageQuery({ page: 'abc', pageSize: '-1' })).toEqual({
      page: 1,
      pageSize: ADMIN_PAGE_SIZE,
      q: '',
    })
  })
})

describe('sliceAdminPage', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('returns the requested slice and the full total', () => {
    expect(sliceAdminPage(items, { page: 2, pageSize: 2, q: '' })).toEqual({
      items: ['c', 'd'],
      page: 2,
      pageSize: 2,
      total: 5,
    })
  })

  it('clamps an overflow page to the last page', () => {
    expect(sliceAdminPage(items, { page: 9, pageSize: 2, q: '' })).toEqual({
      items: ['e'],
      page: 3,
      pageSize: 2,
      total: 5,
    })
  })

  it('keeps page 1 on an empty list', () => {
    expect(sliceAdminPage([], { page: 4, pageSize: 20, q: '' })).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })
  })
})
