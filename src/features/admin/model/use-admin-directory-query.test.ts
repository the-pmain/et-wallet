import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADMIN_SEARCH_DEBOUNCE_MS,
  directoryListIsBusy,
  useAdminDirectoryQuery,
} from './use-admin-directory-query'

describe('useAdminDirectoryQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the input immediately and delays the fetch query', () => {
    const { result } = renderHook(() => useAdminDirectoryQuery())

    act(() => {
      result.current.setSearch('leo@')
    })

    expect(result.current.search).toBe('leo@')
    expect(result.current.query).toBe('')

    act(() => {
      vi.advanceTimersByTime(ADMIN_SEARCH_DEBOUNCE_MS)
    })

    expect(result.current.query).toBe('leo@')
    expect(result.current.page).toBe(1)
  })

  it('does not reset the page when the debounce repeats the same query', () => {
    const { result } = renderHook(() => useAdminDirectoryQuery())

    act(() => {
      result.current.setPage(2)
      vi.advanceTimersByTime(ADMIN_SEARCH_DEBOUNCE_MS)
    })

    expect(result.current.page).toBe(2)
    expect(result.current.query).toBe('')
  })
})

describe('directoryListIsBusy', () => {
  it('is busy while the typed search has not been sent', () => {
    expect(directoryListIsBusy('leo', '', false)).toBe(true)
    expect(directoryListIsBusy('leo', 'leo', false)).toBe(false)
    expect(directoryListIsBusy('leo', 'leo', true)).toBe(true)
  })
})
