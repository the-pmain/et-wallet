import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
import { APP_CONFIG } from '@/shared/config'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  services = createTestAppServices()
})

describe('Home-screen theme studies', () => {
  it('opens the MetaMask study without unlocking', async () => {
    window.history.replaceState(null, '', '/variant-1')
    renderApp()

    expect(await screen.findByRole('heading', { name: '1.5 ETH' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Theme variants' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'MetaMask sections' })).toBeInTheDocument()
  })

  it('opens the Trust Wallet study without unlocking', async () => {
    window.history.replaceState(null, '', '/variant-2')
    renderApp()

    expect(await screen.findByRole('heading', { name: '$4,280.50' })).toBeInTheDocument()
    expect(screen.getByText('Main Wallet')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Trust Wallet sections' })).toBeInTheDocument()
  })

  it('opens the cabinet study without unlocking', async () => {
    window.history.replaceState(null, '', '/variant-3')
    renderApp()

    expect(await screen.findByRole('heading', { name: '$4,280.50' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent sendings' })).toBeInTheDocument()
    expect(screen.getAllByText(APP_CONFIG.brandLabel).length).toBeGreaterThan(0)
  })

  it('switches studies and leaves mock buttons inert', async () => {
    const user = userEvent.setup()

    window.history.replaceState(null, '', '/variant-1')
    renderApp()

    await screen.findByRole('heading', { name: '1.5 ETH' })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(window.location.pathname).toBe('/variant-1')

    await user.click(screen.getByRole('link', { name: 'Trust Wallet' }))
    expect(await screen.findByText('Main Wallet')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/variant-2')
  })
})
