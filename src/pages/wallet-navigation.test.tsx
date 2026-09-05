import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
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

async function findDashboard(): Promise<HTMLElement> {
  return await screen.findByText('Account 1')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Wallet navigation', () => {
  it('shows four sections', async () => {
    renderApp()
    await findDashboard()

    const navigation = screen.getByRole('navigation', { name: 'Wallet sections' })

    for (const label of ['Wallet', 'Assets', 'Activity', 'Settings']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(within(navigation).queryByRole('link', { name: 'NFT' })).not.toBeInTheDocument()
  })

  it('opens the assets section', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument()
  })

  it('opens the NFT section', async () => {
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
  })

  it('opens the activity section', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Activity' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })

  it('opens the settings section', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('keeps the header when moving between sections', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    /* Header and nav live in a shared route layout: recreating them
       on every screen would flicker on navigation. */
    expect(screen.getByText('Account 1')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Wallet sections' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'ET WALLET' }).length).toBeGreaterThan(0)
  })
})

describe('Access to wallet sections', () => {
  it('does not allow settings when the wallet is locked', async () => {
    services.onboarding.lock()
    openPath('/wallet/settings')

    renderApp()

    /* A direct URL must land on the password screen: otherwise the
       user would see UI they have not confirmed access to. */
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })
})

describe('Assets section', () => {
  it('offers token import', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    /* A list of well-known tokens is not preloaded: a token shown in
       the wallet looks endorsed, and anyone can send a lure named
       after a known project. The user adds it. */
    expect(await screen.findByRole('button', { name: /Import a token/i })).toBeInTheDocument()
  })

  it('shows the network native currency', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    expect(await screen.findByText('Ether')).toBeInTheDocument()
  })
})

describe('NFT section', () => {
  it('explains search bounds instead of an empty gallery', async () => {
    /* An empty list with no explanation reads as missing property:
       the search covers a window of blocks, not the whole chain. */
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Searching for items…')).not.toBeInTheDocument()
      expect(screen.getByText('No items found')).toBeInTheDocument()
    })
    expect(screen.getByText(/scans the last/i)).toBeInTheDocument()
  })

  it('warns that loading images would reveal the IP address', async () => {
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
    expect(await screen.findByText(/would see your IP address/i)).toBeInTheDocument()
  })
})

describe('Settings section', () => {
  it('switches appearance', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Dark' }))

    expect(document.documentElement).toHaveClass('dark')
  })

  it('contains account and network management', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('Networks')).toBeInTheDocument()
    expect(screen.queryByText('RPC nodes')).not.toBeInTheDocument()
  })

  it('lets the user choose an auto-lock interval', async () => {
    /* The old check asserted that auto-lock did not exist. It does
       now, and a warning about its absence became false: a warning
       about a limit that does not exist trains people not to read
       the others. */
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText('Lock after inactivity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains why an unlocked wallet is dangerous', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText(/keeps the keys in memory/i)).toBeInTheDocument()
  })
})
