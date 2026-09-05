import { render, screen, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Toaster as ToasterComponent } from './toast'
import type { toast as toastFn } from './toast-store'

/* The module holds toasts at module scope. To keep one test from
   leaking into the next, modules are re-imported each time. */
let Toaster: typeof ToasterComponent
let toast: typeof toastFn

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  Toaster = (await import('./toast')).Toaster
  toast = (await import('./toast-store')).toast
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Toasts', () => {
  it('shows a toast in the region', () => {
    render(<Toaster />)

    act(() => {
      toast('Done')
    })

    expect(screen.getByRole('status')).toHaveTextContent('Done')
  })

  it('dismisses a toast after its duration', () => {
    /* Otherwise they pile up and cover what the person came to see. */
    render(<Toaster />)

    act(() => {
      toast('Will vanish')
    })

    expect(screen.queryByRole('status')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(4500)
    })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be dismissed before the duration ends', () => {
    render(<Toaster />)

    act(() => {
      toast('Dismiss me')
    })

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('announces the region to screen readers', () => {
    /* A toast reports something that already happened; a blind user
       learns of it only through a live region. */
    render(<Toaster />)

    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull()
  })
})
