import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_DURABILITY, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

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

async function openSettings(): Promise<void> {
  await screen.findByText('Account 1')
  openPath('/wallet/settings')

  await screen.findByRole('heading', { name: 'Settings' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Storage durability warning', () => {
  it('in-memory storage is reported as not surviving a reload', async () => {
    /* The test build uses in-memory storage, and it answers honestly.
       Silence here would mean the wallet claims durability it does
       not have. */
    await expect(services.storage.durability()).resolves.toBe(STORAGE_DURABILITY.Session)
  })

  it('settings no longer show a storage-durability warning', async () => {
    renderApp()
    await openSettings()

    expect(screen.queryByText(/will not survive closing the tab/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/from the\s+seed phrase you wrote down/i)).not.toBeInTheDocument()
  })

  it('the obsolete claim about losing access after a reload is gone', async () => {
    /* The text was true while storage lived in memory. After IndexedDB
       arrived it would have become a lie on the settings screen. */
    renderApp()
    await openSettings()

    expect(screen.queryByText(/The storage works in memory/i)).not.toBeInTheDocument()
  })
})
