import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
import { DEFAULT_ACCENT_HEX } from '@/shared/theme'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

const PASSWORD = 'Korova-7-Luna!'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(async () => {
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })
  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Settings appearance', () => {
  it('lets the owner pick the main colour without leaving Light or Dark', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText('Account 1')
    await user.click(screen.getAllByRole('link', { name: 'Settings' })[0]!)

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Graphite' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset['accent']).toBe(DEFAULT_ACCENT_HEX)

    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Teal' }))
    expect(document.documentElement.dataset['accent']).toBe('#0F766E')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset['accent']).toBe('#0F766E')
  })
})
