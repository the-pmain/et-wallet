import { describe, expect, it } from 'vitest'

import {
  adminPageSearch,
  parseAdminDirectorySending,
  parseAdminPage,
} from './admin-page'

describe('adminPageSearch', () => {
  it('omits an empty query', () => {
    expect(adminPageSearch({ page: 2, pageSize: 20, q: '  ' })).toBe('?page=2&pageSize=20')
  })

  it('includes a trimmed query', () => {
    expect(adminPageSearch({ page: 1, pageSize: 20, q: ' leo@ ' })).toBe(
      '?page=1&pageSize=20&q=leo%40',
    )
  })

  it('includes a pending status filter', () => {
    expect(adminPageSearch({ page: 1, pageSize: 100, q: '', status: 'pending' })).toBe(
      '?page=1&pageSize=100&status=pending',
    )
  })
})

describe('parseAdminPage', () => {
  it('reads a sendings page with a joined email', () => {
    const page = parseAdminPage(
      {
        items: [
          {
            id: '62',
            createdAt: '2026-08-22T14:59:14.037Z',
            userId: '74',
            userEmail: 'leo@example.com',
            status: 'pending',
            failureMessage: null,
            recipientAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
            amount: '4',
            symbol: 'ETH',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      parseAdminDirectorySending,
    )

    expect(page).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(page?.items[0]?.userEmail).toBe('leo@example.com')
  })

  it('rejects a row without userEmail', () => {
    expect(
      parseAdminPage(
        {
          items: [
            {
              id: '62',
              createdAt: '2026-08-22T14:59:14.037Z',
              userId: '74',
              status: 'pending',
              failureMessage: null,
              recipientAddress: null,
              amount: '4',
              symbol: 'ETH',
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
        parseAdminDirectorySending,
      ),
    ).toBeNull()
  })
})
