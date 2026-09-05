import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TEST_MODE } from '@/shared/config'
import { createTestAppServices } from '@/test/doubles'

import { App } from './App'
import { AppProviders } from './providers'

/**
 * Checks the app assembly as a whole: providers, routing, wallet-state
 * detection.
 *
 * Encryption is swapped for a fast stand-in — production's 600 000
 * PBKDF2 iterations have nothing to do with what is checked here.
 */
function renderApp() {
  const services = createTestAppServices()

  render(
    <AppProviders services={services}>
      <App />
    </AppProviders>,
  )

  return services
}

describe('App', () => {
  it('shows the welcome screen for an uncreated wallet', async () => {
    renderApp()

    /* The tell is the brand mark: the recognisable look is a weak
       barrier against a phishing copy, so its presence on the first
       screen is checked separately from the heading text. */
    expect(await screen.findByRole('img', { name: 'ETWallet' })).toBeInTheDocument()
  })

  it('offers wallet creation', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
  })

  it('shows seed-phrase import according to the mode flag', async () => {
    /* A temporary relaxation removes this path entirely. The check
       follows the flag instead of pinning one state: putting the
       protection back must not break the suite. */
    renderApp()

    await screen.findByRole('link', { name: /create a new wallet/i })

    const importLink = screen.queryByRole('link', { name: /import/i })

    expect(importLink === null).toBe(TEST_MODE.hideSeedImport)
  })
})
