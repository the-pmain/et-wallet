import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DAPP_REQUEST_KIND,
  toAddress,
  toChainId,
  type Address,
  type HexString,
  type IDappRequest,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { TransactionRepository } from '@/core/transaction/TransactionRepository'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

const ETHEREUM = toChainId(1n)

const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/**
 * Opens the connections screen and waits until the transport is ready.
 *
 * THE WAIT IS REQUIRED. The event subscription is created inside
 * `init`, asynchronously. An event sent before that is lost — and
 * the test fails not because the screen is broken, but because it
 * raced the subscription.
 */
async function openConnections(): Promise<void> {
  await screen.findByText('Account 1')
  openPath('/wallet/connections')

  await screen.findByRole('heading', { name: 'Connections' })

  await waitFor(() => {
    expect(services.dappSessions.getSnapshot().isReady).toBe(true)
  })
}

/** A message-signature request. */
function messageRequest(address: Address = OWNER): IDappRequest {
  return {
    id: 'req-1',
    sessionId: 'session-1',
    dapp: { name: 'Example', url: 'https://example.com', description: null, iconUrl: null },
    chainId: ETHEREUM,
    payload: {
      kind: DAPP_REQUEST_KIND.SignMessage,
      address,
      message: 'Sign in to the application',
    },
  }
}

/** A request to sign an unlimited approval. */
function unlimitedPermitRequest(): IDappRequest {
  return {
    id: 'req-2',
    sessionId: 'session-1',
    dapp: { name: 'Example', url: 'https://example.com', description: null, iconUrl: null },
    chainId: ETHEREUM,
    payload: {
      kind: DAPP_REQUEST_KIND.SignTypedData,
      address: OWNER,
      typedData: {
        domain: { name: 'USD Coin', chainId: ETHEREUM, verifyingContract: TOKEN },
        types: { Permit: [{ name: 'value', type: 'uint256' }] },
        primaryType: 'Permit',
        message: { owner: OWNER, spender: SPENDER, value: (2n ** 256n - 1n).toString() },
      },
    },
  }
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Connections: screen', () => {
  it('opens and reports that there are no connections', async () => {
    renderApp()
    await openConnections()

    expect(screen.getByText('No connections')).toBeInTheDocument()
  })

  it('names what the WalletConnect server can see', async () => {
    /* The relay sees addresses and the time of every request — an
       indexer-level leak, and it cannot be left unspoken. */
    renderApp()
    await openConnections()

    expect(screen.getByText(/sees the addresses of your accounts/i)).toBeInTheDocument()
  })

  it('warns not to paste links from email', async () => {
    renderApp()
    await openConnections()

    expect(screen.getByText(/Do not paste links/i)).toBeInTheDocument()
  })
})

describe('Connections: proposal', () => {
  it('shows a proposal with the list of permissions', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/The application will get/i)).toBeInTheDocument()
    expect(screen.getByText(/the seed phrase or the private keys/i)).toBeInTheDocument()
  })

  it('warns that the app name cannot be verified', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/Anyone can claim to be a/i)).toBeInTheDocument()
  })

  it('connects after consent', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])
    await user.click(await screen.findByRole('button', { name: 'Allow the connection' }))

    await waitFor(() => {
      expect(services.dappTransport.proposalAnswers).toHaveLength(1)
    })
    expect(services.dappTransport.lastApprovedAddresses()).toContain(OWNER)
  })

  it('a refusal is sent to the app', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(services.dappTransport.proposalAnswers.at(-1)?.[1]).toBeNull()
    })
  })
})

describe('Connections: signature request', () => {
  it('shows the message text, not a hash', async () => {
    /* A hash tells the user nothing, and they would confirm blind. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())

    expect(await screen.findByText('Sign in to the application')).toBeInTheDocument()
  })

  it('warns about a token approval', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(
      await screen.findByText('This signature hands over control of your tokens'),
    ).toBeInTheDocument()
  })

  it('warns about an unlimited amount', async () => {
    /* That is how access to every token is given without seeing a
       debit or a fee. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(await screen.findByText('The approved amount is unlimited')).toBeInTheDocument()
  })

  it('notes that a signature cannot be revoked', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())

    expect(await screen.findByText(/A signature cannot be revoked/i)).toBeInTheDocument()
  })

  it('signs after confirmation and password', async () => {
    /* The password is asked under the same setting as a send from
       the wallet: a remote request must not be weaker than the
       owner's own action. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(services.dappTransport.responses).toHaveLength(1)
    })

    const response = services.dappTransport.responses[0]?.response

    expect(response?.kind).toBe('approved')
    expect(response?.kind === 'approved' ? response.result : '').toMatch(/^0x[0-9a-f]+$/i)
  })

  it('without the password the signature is not made', async () => {
    /* An app that waited for the wallet to unlock must not get a
       signature with one tap. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(services.dappTransport.responses).toHaveLength(0)
  })

  it('a wrong password does not produce a signature', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    await user.type(await screen.findByLabelText('Password'), 'Sobaka-9-Solnce!')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(services.dappTransport.responses).toHaveLength(0)
  })

  it('rejects on refuse and does not sign', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

    await waitFor(() => {
      expect(services.dappTransport.responses.at(-1)?.response.kind).toBe('rejected')
    })
  })

  it('a request from a foreign address is rejected without a prompt', async () => {
    /* There is nothing to sign with for a foreign address, and an
       extra screen trains people to tap Confirm without reading. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest(SPENDER))

    await waitFor(() => {
      expect(services.dappTransport.responses.at(-1)?.response.kind).toBe('rejected')
    })

    expect(screen.queryByText('Sign in to the application')).not.toBeInTheDocument()
  })
})

describe('Connections: disconnecting sessions', () => {
  it('shows a live connection and disconnects it', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitConnected({
      id: 'session-1',
      dapp: { name: 'Exchange', url: 'https://example.com', description: null, iconUrl: null },
      chainIds: [ETHEREUM],
      addresses: [OWNER],
      connectedAt: 0,
      expiresAt: null,
    })

    expect(await screen.findByText('Exchange')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Disconnect Exchange/i }))

    await waitFor(() => {
      expect(services.dappTransport.disconnected).toEqual(['session-1'])
    })
  })
})

describe('Connections: contract deployment', () => {
  /** A request with no recipient: that is how an app asks to deploy a contract. */
  function deploymentRequest(): IDappRequest {
    return {
      id: 'req-3',
      sessionId: 'session-1',
      dapp: { name: 'Example', url: 'https://example.com', description: null, iconUrl: null },
      chainId: ETHEREUM,
      payload: {
        kind: DAPP_REQUEST_KIND.SendTransaction,
        transaction: {
          from: OWNER,
          to: null,
          value: 0n,
          data: '0x60806040' as HexString,
          gasLimit: null,
        },
      },
    }
  }

  it('warns that the request creates a contract', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(deploymentRequest())

    expect(await screen.findByText('A contract is being deployed')).toBeInTheDocument()
  })

  it('a deployment is signed, not a transfer to self', async () => {
    /* The recipient used to be replaced with the sender: the user
       approved creating a contract and signed a transfer to self with
       bytecode in the call data — gas was spent, the approved
       operation never ran. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(deploymentRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(services.dappTransport.responses).toHaveLength(1)
    })

    /* A transaction with no recipient serializes with an empty `to`.
       It can be decoded again from storage: the send record keeps
       what went on-chain. */
    const saved = await new TransactionRepository(services.secureStorage).findByAddress(
      OWNER,
      ETHEREUM,
    )

    expect(saved).toHaveLength(1)
    expect(saved[0]?.to).toBeNull()
  })
})
