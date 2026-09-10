import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { WALLET_BROADCAST, WalletBroadcast } from '@/features/onboarding'
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

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Wallet erase in a neighboring tab', () => {
  it('closes an open wallet', async () => {
    /* THE MOST DANGEROUS TWO-TAB CASE. Storage is shared; memory is
       not: the tab holds the encryption key and never learns about the
       erase. It kept showing balances and allowed a signed transfer —
       so someone who erased the wallet before handing the device over
       left a door open. */
    renderApp()

    await screen.findByText('Account 1')

    /* The message comes from another tab: a tab does not echo its own. */
    const other = new WalletBroadcast(services.broadcastName)

    other.post(WALLET_BROADCAST.Erased)

    await waitFor(() => {
      expect(screen.queryByText('Account 1')).not.toBeInTheDocument()
    })

    other.close()
  })

  it('the tab returns to the welcome screen', async () => {
    renderApp()
    await screen.findByText('Account 1')

    const other = new WalletBroadcast(services.broadcastName)

    other.post(WALLET_BROADCAST.Erased)

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()

    other.close()
  })

  it('an unknown message does not close the wallet', async () => {
    /* Any code can write to a channel of the same origin. Closing the
       wallet on an unknown message would give a way to disrupt the
       owner. */
    renderApp()
    await screen.findByText('Account 1')

    new BroadcastChannel(services.broadcastName).postMessage('lock-everything')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByText('Account 1')).toBeInTheDocument()
  })
})
