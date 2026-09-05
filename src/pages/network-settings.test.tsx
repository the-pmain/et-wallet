import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toChainId, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** An id not taken by any built-in network. */
const CUSTOM_CHAIN = 31_337

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openSettings(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Settings' })
}

async function openAddForm(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /Add a network/i }))
  await screen.findByLabelText('Network name')
}

async function fillNetwork(name: string, chainId: number): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Network name'), name)
  await user.type(screen.getByLabelText('Chain ID'), String(chainId))
  await user.type(screen.getByLabelText('RPC endpoint'), 'https://node.example')
  await user.type(screen.getByLabelText('Currency symbol'), 'TST')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Networks: list', () => {
  it('lists the built-in networks', async () => {
    renderApp()
    await openSettings()

    /* The query is scoped to the networks card: the active network
       name also appears in the shell header. */
    const card = screen.getByText('Networks').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText('Ethereum')).toBeInTheDocument()
    expect(within(card).getByText('Polygon')).toBeInTheDocument()
  })

  it('does not offer to delete a built-in network', async () => {
    renderApp()
    await openSettings()

    /* Built-in network config is part of impersonation protection:
       after deleting the main network the user could add a namesake
       with a foreign id. */
    expect(
      screen.queryByRole('button', { name: /remove network Ethereum/i }),
    ).not.toBeInTheDocument()
  })

  it('switches the active network', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.click(screen.getByText('Polygon'))

    await waitFor(() => {
      expect(
        screen.getByText(`chainId ${BUILT_IN_CHAIN_ID.Polygon.toString()} · POL`),
      ).toBeVisible()
    })
  })
})

describe('Networks: add', () => {
  it('adds a custom network after the node is checked', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })
  })

  it('marks an added network as custom', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* The difference between a checked built-in config and one added
       by hand matters: for the latter both the node and the explorer
       are set by whoever added it. */
    await waitFor(() => {
      expect(screen.getByText('custom')).toBeInTheDocument()
    })
  })

  it('warns about impersonation when the name matches a built-in network', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* Checking chainId with the node will not catch this: the node
       will honestly confirm its own id. */
    expect(await screen.findByText('The network impersonates an existing one')).toBeInTheDocument()
    expect(screen.getByText(/a common network spoofing trick/i)).toBeInTheDocument()
  })

  it('does not add a namesake network without consent', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await screen.findByText('The network impersonates an existing one')

    expect(screen.queryByText('custom')).not.toBeInTheDocument()
  })

  it('adds a namesake network after explicit consent', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await user.click(await screen.findByRole('button', { name: 'Add anyway' }))

    await waitFor(() => {
      expect(screen.getByText('custom')).toBeInTheDocument()
    })
  })

  it('shows the node refusal reason verbatim', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })

    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)
    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* "The node serves a different network" and "the address is
       unreachable" need different actions: a generic message would
       leave the user unable to see what to fix. */
    /* The screen has several warnings: a standing one about trusting
       the node, and the new refusal message. The check is that the
       second is among them, not that it is the only alert. */
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '')

      expect(alerts.some((text) => /No RPC endpoints are available|chainId 137/.test(text))).toBe(
        true,
      )
    })
  })

  it('warns that the adder sets the node and the explorer', async () => {
    renderApp()
    await openSettings()
    await openAddForm()

    expect(screen.getByText(/supplied by whoever\s+adds the network/i)).toBeInTheDocument()
  })
})

describe('Networks: delete', () => {
  it('deletes a custom network', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove network My Private Chain' }))

    await waitFor(() => {
      expect(screen.queryByText('My Private Chain')).not.toBeInTheDocument()
    })
  })

  it('returns the wallet to the default network after deleting the active one', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByText('My Private Chain'))
    await user.click(screen.getByRole('button', { name: 'Remove network My Private Chain' }))

    /* Deleting the active network must leave the wallet usable, not
       in a "there is no active network" state. */
    await waitFor(() => {
      const list = screen.getByText('Networks').closest('[data-slot=card]') as HTMLElement

      expect(within(list).getByText('Ethereum')).toBeInTheDocument()
    })
  })
})
