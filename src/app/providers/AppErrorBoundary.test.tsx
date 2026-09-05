import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from './AppErrorBoundary'

function Broken(): never {
  throw new Error('The asset list broke')
}

beforeEach(() => {
  /* React prints the crash itself, and the catcher's output is added
     on top. The stub removes the noise without hiding the check: the
     call itself is asserted in a separate test. */
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('render failure catch', () => {
  it('renders a healthy tree unchanged', () => {
    render(
      <AppErrorBoundary>
        <p>Balance</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Balance')).toBeInTheDocument()
  })

  it('does not leave a blank screen on failure', () => {
    /* A white screen is indistinguishable from money gone for the
       owner of funds. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'The application stopped' })).toBeInTheDocument()
  })

  it('says outright that funds are intact', () => {
    /* The only question that arises for someone who saw a wallet
       failure. "Something went wrong" does not answer it. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByText(/Your funds are safe/i)).toBeInTheDocument()
    expect(screen.getByText(/neither the/i)).toBeInTheDocument()
  })

  it('shows the cause verbatim', () => {
    /* Without the cause the owner cannot tell whether the crash
       repeats, or report it. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('The asset list broke')).toBeInTheDocument()
  })

  it('offers a reload and explains the phrase is not needed', () => {
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByText(/The seed phrase is not needed to reload/i)).toBeInTheDocument()
  })

  it('writes failure details to the console', () => {
    /* Otherwise they vanish with the component tree, and there is
       nothing to diagnose a repeating failure with. */
    render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalled()
  })
})
