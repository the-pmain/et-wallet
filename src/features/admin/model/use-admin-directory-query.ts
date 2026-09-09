import { useEffect, useState } from 'react'

import { ADMIN_PAGE_SIZE } from './admin-page'

export const ADMIN_SEARCH_DEBOUNCE_MS = 200

/** Page and search for a cabinet directory list. Search resets to page 1. */
export function useAdminDirectoryQuery(): {
  readonly page: number
  readonly pageSize: number
  readonly query: string
  readonly search: string
  readonly setPage: (page: number) => void
  readonly setSearch: (query: string) => void
} {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery((current) => {
        if (current !== search) {
          setPage(1)
        }

        return search
      })
    }, ADMIN_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(handle)
    }
  }, [search])

  return {
    page,
    pageSize: ADMIN_PAGE_SIZE,
    query,
    search,
    setPage,
    setSearch,
  }
}

/** True while the typed search has not landed, or a fetch is open. */
export function directoryListIsBusy(
  search: string,
  query: string,
  isFetching: boolean,
): boolean {
  return search !== query || isFetching
}
