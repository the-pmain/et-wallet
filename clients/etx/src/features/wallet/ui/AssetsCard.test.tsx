import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

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
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 1_500_000_000_000_000_000n as Wei })
  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('AssetsCard', () => {
  it('на главном экране показывает те же активы, что и раздел Assets', async () => {
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(await screen.findByText('Ether')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all assets/i })).toHaveAttribute(
      'href',
      '/wallet/assets',
    )
  })
})
