import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Third address of the test phrase: it was "used" before recovery. */
const THIRD = toAddress(TEST_MNEMONIC_ADDRESSES[2] as string)

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.location.hash = ''
  services = createTestAppServices()
})

describe('Recovery finds used addresses', () => {
  it('an account with a balance appears on its own', async () => {
    /* THE MOST DANGEROUS FIRST SCREEN. Addresses are derived from the
       phrase, but the wallet does not know them until it derives them:
       someone who had three accounts would see one and reasonably
       conclude the funds were gone. */
    services.providerFactory.configure({
      balance: 0n as Wei,
      balancesByAddress: [{ address: THIRD, balance: BALANCE }],
    })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()

    await waitFor(
      () => {
        expect(services.session.getSnapshot().accounts.length).toBeGreaterThan(1)
      },
      { timeout: 10_000 },
    )

    const addresses = services.session
      .getSnapshot()
      .accounts.map((account) => account.address.toLowerCase())

    expect(addresses).toContain(THIRD.toLowerCase())
  })

  it('an empty wallet does not receive extra accounts', async () => {
    /* Search found nothing, so nothing should be added. An extra
       account would confuse as much as a missing one. */
    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })

  it('search can be repeated from a button in settings', async () => {
    /* The first search may have run while the node was down. The
       button repeats it without recreating the wallet. */
    const user = userEvent.setup()

    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    services.providerFactory.configure({
      balance: 0n as Wei,
      balancesByAddress: [{ address: THIRD, balance: BALANCE }],
    })

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /Find my accounts/i }))

    expect(await screen.findByText(/Found and added 1 account/i)).toBeInTheDocument()
  })

  it('the result names the search depth and its limits', async () => {
    /* "Nothing found" without a depth reads as "you have nothing else"
       — a claim the search does not make: addresses that hold only
       tokens are invisible to it. */
    const user = userEvent.setup()

    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /Find my accounts/i }))

    expect(await screen.findByText(/addresses were checked/i)).toBeInTheDocument()
    expect(screen.getByText(/only tokens or collectibles are not found/i)).toBeInTheDocument()
  })
})
