import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toChainId, type Wei } from '@/core'
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

/**
 * Opens settings, where RPC node controls live.
 *
 * Nodes were moved off the home screen on purpose: home answers
 * "how much do I have and what is happening", and choosing a node
 * changes how the wallet is built and needs a deliberate trip into
 * settings.
 */
async function openSettings(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Settings' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('RPC panel', () => {
  it('is hidden from settings', async () => {
    renderApp()
    await openSettings()

    expect(screen.queryByText('RPC nodes')).not.toBeInTheDocument()
    expect(screen.queryByText('Transaction check')).not.toBeInTheDocument()
  })
})

describe.skip('RPC panel: node list', () => {
  it("shows the active network's nodes and names their source", async () => {
    renderApp()
    await openSettings()

    expect(screen.getByText('ethereum-rpc.publicnode.com')).toBeInTheDocument()
    expect(screen.getAllByText(/Public node/).length).toBeGreaterThan(0)
  })

  it('marks the node in use', async () => {
    renderApp()
    await openSettings()

    /* The user must see whose node the wallet talks to: the operator
       sees their IP and every address that is queried. */
    await waitFor(() => {
      expect(screen.getByText(/in use now/)).toBeInTheDocument()
    })
  })

  it('shows only the node name, not a path with a key', async () => {
    renderApp()
    await openSettings()

    /* The URL path holds an access key. A key shown on screen leaks
       in screen shares and screenshots. */
    expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument()
  })
})

describe.skip('RPC panel: availability check', () => {
  it('shows the response time of a working node', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.click(screen.getByRole('button', { name: /Check/i }))

    await waitFor(() => {
      expect(screen.getAllByLabelText('Available').length).toBeGreaterThan(0)
    })
  })

  it('marks unavailable nodes', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({ unavailable: true })
    await user.click(screen.getByRole('button', { name: /Check/i }))

    await waitFor(() => {
      expect(screen.getAllByLabelText('Unavailable').length).toBeGreaterThan(0)
    })
  })

  it('reports a foreign network separately', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })
    await user.click(screen.getByRole('button', { name: /Check/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/serves a different network/).length).toBeGreaterThan(0)
    })
  })
})

describe.skip('RPC panel: a custom URL', () => {
  it('adds a node and puts it first', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.type(screen.getByLabelText('Your own RPC endpoint'), 'https://my-node.example')
    await user.click(screen.getByRole('button', { name: /Add the node/i }))

    await waitFor(() => {
      expect(screen.getByText('my-node.example')).toBeInTheDocument()
    })
    expect(screen.getByText(/Your own node/)).toBeInTheDocument()
  })

  it('shows the refusal reason from a node on a different network', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })

    await user.type(screen.getByLabelText('Your own RPC endpoint'), 'https://wrong-chain.example')
    await user.click(screen.getByRole('button', { name: /Add the node/i }))

    /* "The node serves a different network" and "the node does not
       answer" need different actions: swapping the first for the
       second would mislead. */
    /* The pattern includes a verb: "chainId 137" also appears in the
       network list as the Polygon row, and that query would match both. */
    await waitFor(() => {
      expect(screen.getByText(/returned chainId 137/)).toBeInTheDocument()
    })
    expect(screen.queryByText('wrong-chain.example')).not.toBeInTheDocument()
  })

  it('warns that adding a node is a trust decision', async () => {
    renderApp()
    await openSettings()

    expect(screen.getByText(/a dishonest node will show something other/i)).toBeInTheDocument()
  })

  it('removes an added node', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.type(screen.getByLabelText('Your own RPC endpoint'), 'https://my-node.example')
    await user.click(screen.getByRole('button', { name: /Add the node/i }))

    await waitFor(() => {
      expect(screen.getByText('my-node.example')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove my-node.example' }))

    await waitFor(() => {
      expect(screen.queryByText('my-node.example')).not.toBeInTheDocument()
    })
  })
})
