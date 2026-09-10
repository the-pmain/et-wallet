import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { ThemeProvider } from '@/app/providers/ThemeProvider'

import { AccentColorPicker } from './AccentColorPicker'
import { ACCENT_COLOR_STORAGE_KEY, DEFAULT_ACCENT_HEX } from './index'

function renderPicker() {
  return render(
    <ThemeProvider>
      <AccentColorPicker />
    </ThemeProvider>,
  )
}

describe('AccentColorPicker', () => {
  afterEach(() => {
    localStorage.removeItem(ACCENT_COLOR_STORAGE_KEY)
    document.documentElement.removeAttribute('data-accent')
  })

  it('selects graphite by default', () => {
    renderPicker()

    expect(screen.getByRole('button', { name: 'Graphite' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset['accent']).toBe(DEFAULT_ACCENT_HEX)
  })

  it('applies a preset and keeps the light or dark class independent', async () => {
    const user = userEvent.setup()
    const wasDark = document.documentElement.classList.contains('dark')

    renderPicker()
    await user.click(screen.getByRole('button', { name: 'Azure' }))

    expect(screen.getByRole('button', { name: 'Azure' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset['accent']).toBe('#1D4ED8')
    expect(localStorage.getItem(ACCENT_COLOR_STORAGE_KEY)).toBe('#1D4ED8')
    expect(document.documentElement.classList.contains('dark')).toBe(wasDark)
  })

  it('names Light and Dark as a separate choice', () => {
    renderPicker()

    expect(screen.getByText(/Light and Dark above stay as you set them/i)).toBeInTheDocument()
  })
})
