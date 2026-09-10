import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
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

describe('Этюды темы главного экрана', () => {
  it('открывает MetaMask-этюд без разблокировки', async () => {
    window.history.replaceState(null, '', '/variant-1')
    renderApp()

    expect(await screen.findByRole('heading', { name: '1.5 ETH' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Theme variants' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'MetaMask sections' })).toBeInTheDocument()
  })

  it('открывает Trust Wallet-этюд без разблокировки', async () => {
    window.history.replaceState(null, '', '/variant-2')
    renderApp()

    expect(await screen.findByRole('heading', { name: '$4,280.50' })).toBeInTheDocument()
    expect(screen.getByText('Main Wallet')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Trust Wallet sections' })).toBeInTheDocument()
  })

  it('открывает кабинетный этюд без разблокировки', async () => {
    window.history.replaceState(null, '', '/variant-3')
    renderApp()

    expect(await screen.findByRole('heading', { name: '$4,280.50' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent sendings' })).toBeInTheDocument()
    expect(screen.getAllByText('ET WALLET').length).toBeGreaterThan(0)
  })

  it('переключает этюды и оставляет кнопки макета пустыми', async () => {
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
