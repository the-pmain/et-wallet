import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { LOGIN_CREDENTIALS_STORAGE_KEY, writeLoginCredentials } from '@/features/onboarding'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  TestEventSource,
  type IFakeToken,
  type ITestAppServices,
} from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const RECIPIENT = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Ten ether: enough for a transfer and the fee. */
const BALANCE = (10n ** 19n) as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openSend(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /send/i }))
  await screen.findByRole('heading', { name: 'Send' })
}

async function openAssetSelect(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('combobox', { name: 'What to send' }))
}

async function selectSendAsset(label: string | RegExp): Promise<void> {
  const user = userEvent.setup()

  await openAssetSelect()
  await user.click(screen.getByRole('option', { name: label }))
}

/**
 * Fills the form and moves to confirmation.
 *
 * WAITING FOR RESOLUTION IS REQUIRED. The field accepts both an
 * address and an ENS name, so the input is resolved with a delay
 * and asynchronously. Next is disabled until resolution ends — a
 * click without waiting would hit a disabled button and the test
 * would flake.
 */
async function fillAndContinue(recipient: string, amount: string): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText(/Recipient address/), recipient)
  await user.type(screen.getByLabelText(/Amount/), amount)

  const next = screen.getByRole('button', { name: 'Next' })

  await waitFor(() => {
    expect(next).toBeEnabled()
  })

  await user.click(next)
}

/**
 * Completes send confirmation, including typing the password again.
 *
 * The password is asked by default: it protects against someone who
 * reached an already unlocked wallet.
 */
async function confirmAndSend(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
  await user.type(await screen.findByLabelText('Password'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Send: form', () => {
  it('connects to sendings SSE and closes the stream on leave', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()

    const sources = TestEventSource.instances.filter((source) => source.url.includes('/v1/sendings'))

    expect(sources).toHaveLength(1)
    expect(sources[0]?.url).toBe('/v1/sendings')
    expect(sources[0]?.closed).toBe(false)

    await user.click(screen.getByRole('link', { name: /^wallet$/i }))

    expect(sources[0]?.closed).toBe(true)
  })

  it('shows the sender and the available balance', async () => {
    renderApp()
    await openSend()

    const expected = TEST_MNEMONIC_ADDRESSES[0] as string
    const shortened = `${expected.slice(0, 6)}…${expected.slice(-6)}`

    /* The shortened address also appears in the shell header: the
       query is scoped to the sender card. */
    const card = screen.getByText('From').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText(shortened)).toBeInTheDocument()

    /* Available amount sits next to the input, not on the sender
       card: it is a limit on the number being typed, and it must be
       read where the number is typed. The check is the adjacency —
       otherwise a change could move the label back up unnoticed. */
    const amountField = screen.getByLabelText(/^Amount/)
    const amountBlock = amountField.parentElement as HTMLElement

    expect(within(amountBlock).getByText('10 ETH')).toBeInTheDocument()
  })

  it('does not go further without a recipient address', async () => {
    renderApp()
    await openSend()

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('does not go further with an invalid address', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()

    await user.type(screen.getByLabelText(/Recipient address/), '0x123')
    await user.type(screen.getByLabelText(/Amount/), '1')

    /* The wait is needed here too: resolution is delayed, and a
       check right after typing would catch the button disabled for
       another reason — resolution not finished yet. */
    expect(await screen.findByText(/Enter a 42-character address/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('reports an invalid amount', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '0')

    /* Zero is rejected before talking to the network: there is no
       point pricing gas for a transfer that will not happen. */
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument()
  })

})

describe('Send: confirmation', () => {
  it('shows the fields of the transaction being signed', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* What is shown must match what is signed: the screen prints
       fields of the ready object, not values recalculated from
       scratch. */
    expect(screen.getByText('1 ETH')).toBeInTheDocument()
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
    expect(screen.getByText(TEST_MNEMONIC_ADDRESSES[0] as string)).toBeInTheDocument()
  })

  it('shows the recipient in full, not shortened', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* A shortened address cannot be checked character by character,
       and that check is what protects against clipboard swap. */
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
  })

  it('shows chainId, nonce, and the gas limit', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('chainId')).toBeInTheDocument()
    expect(screen.getByText('Nonce')).toBeInTheDocument()
    expect(screen.getByText('Gas limit')).toBeInTheDocument()
  })

  it('warns that the transfer is irreversible', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/A transfer on the blockchain cannot be undone/i)).toBeInTheDocument()
  })

  it('warns about an address without a checksum', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT.toLowerCase(), '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/a typo in it goes unnoticed/i)).toBeInTheDocument()
  })

  it('warns about a transfer to self', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(TEST_MNEMONIC_ADDRESSES[0] as string, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(/The recipient is the same as the sender/i)).toBeInTheDocument()
  })

  it('lets the user go back to edit', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('heading', { name: 'Send' })).toBeInTheDocument()
  })
})

describe('Send: result', () => {
  it('shows the hash of the published transaction', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()

    expect(await screen.findByRole('heading', { name: 'Transaction sent' })).toBeInTheDocument()
    expect(screen.getByText(/^0x[0-9a-fA-F]+$/)).toBeInTheDocument()
  })

  it('notes that acceptance by the node does not mean inclusion in a block', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()

    await waitFor(() => {
      expect(screen.getByText(/does not mean inclusion in a block/i)).toBeInTheDocument()
    })
  })
})

describe('Send: password confirmation', () => {
  it('asks for the password before signing', async () => {
    /* Protects against someone who reached an already unlocked
       wallet: a left-behind device, someone else's session. */
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText(/sending the transfer/i)).toBeInTheDocument()
  })

  it('does not send on a wrong password', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
    await user.type(await screen.findByLabelText('Password'), 'Nepravilnyy-1!')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transaction sent' })).not.toBeInTheDocument()
  })

  it('lets the user decline confirmation', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await user.click(screen.getByRole('button', { name: 'Confirm and send' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeInTheDocument()
  })
})

describe('Send: contract recipient', () => {
  it('warns about a transfer to an address that has code', async () => {
    /* Coins sent to a contract that does not accept them are lost
       for good. */
    services.providerFactory.configure({ balance: BALANCE, contractAddresses: [RECIPIENT] })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText('The recipient is a contract')).toBeInTheDocument()
  })

  it('does not warn about an ordinary address', async () => {
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText('The recipient is a contract')).not.toBeInTheDocument()
  })
})

describe('Send: insufficient funds', () => {
  it('rejects a transfer that lacks funds together with the fee', async () => {
    services.providerFactory.configure({ balance: 1n as Wei })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '1')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})

describe('Send: ERC-20 token', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  /** A six-decimal token: substituting the usual eighteen is visible. */
  const USDC: IFakeToken = {
    address: TOKEN,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: 250_000_000n,
  }

  async function fillTokenForm(amount: string): Promise<void> {
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(RECIPIENT, amount)
  }

  beforeEach(async () => {
    services.providerFactory.configure({ balance: BALANCE, tokens: [USDC] })

    /* The token is added before render: the send screen takes the
       asset list from the snapshot, and the session fills it. */
    await services.session.open()
    await services.session.addToken(TOKEN)
  })

  it('the token is available to send in the asset list', async () => {
    renderApp()
    await openSend()
    await openAssetSelect()

    expect(screen.getByRole('option', { name: /Select USDC on Ethereum/ })).toBeInTheDocument()
  })

  it('shows the contract address of the selected token', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)

    /* The symbol is set by the contract author, and anyone can mint
       a token named USDC. The address is what distinguishes the real
       one from a fake. */
    expect(screen.getByText(TOKEN)).toBeInTheDocument()
  })

  it('the amount uses the token decimals, not eighteen', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('10')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* Ten USDC is 10 000 000 units, not 10^19. Substituting the
       usual eighteen decimals would shrink the transfer by a
       trillion. */
    expect(screen.getByText('10 USDC')).toBeInTheDocument()
  })

  it('the transaction is addressed to the contract, and that is said plainly', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    /* Someone comparing addresses must understand why there are two:
       otherwise they will think the wallet swapped the recipient. */
    expect(screen.getByText(/will be sent to the token contract/i)).toBeInTheDocument()
    expect(screen.getByText(TOKEN)).toBeInTheDocument()
  })

  it('the real recipient is shown, not the contract address', async () => {
    renderApp()
    await openSend()
    await fillTokenForm('1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.getByText(RECIPIENT)).toBeInTheDocument()
  })

  it('does not let more tokens be sent than are held', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '1000')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('changing the asset clears the amount', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await user.type(screen.getByLabelText(/Amount/), '10')
    await selectSendAsset(/Select USDC on Ethereum/)

    /* Assets have different decimals: "10" typed for ether would
       mean a different quantity at six decimals. */
    expect(screen.getByLabelText(/Amount/)).toHaveValue('')
  })

  it('available amount is shown in token units', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)

    expect(await screen.findByText('250 USDC')).toBeInTheDocument()
  })

  it('a sent token appears in history as a token transfer', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSend()
    await fillTokenForm('10')

    await screen.findByRole('heading', { name: 'Confirmation' })
    await confirmAndSend()
    await screen.findByRole('heading', { name: 'Transaction sent' })

    await user.click(screen.getByRole('link', { name: /back to the wallet/i }))
    await user.click(await screen.findByRole('link', { name: /all activity/i }))

    /* The record is built from the signed data: if the wallet did
       not decode the call, history would show a transfer of zero to
       an unknown party. */
    const list = within(await screen.findByRole('list'))

    expect(list.getByText('Token')).toBeInTheDocument()
    expect(list.getByText(/USDC/u)).toBeInTheDocument()
  })
})

describe('Send: recipient is the token contract', () => {
  const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

  const USDC: IFakeToken = {
    address: TOKEN,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: 250_000_000n,
  }

  beforeEach(async () => {
    services.providerFactory.configure({ balance: BALANCE, tokens: [USDC] })

    await services.session.open()
    await services.session.addToken(TOKEN)
  })

  it('warns about a certain loss', async () => {
    /* The most common irreversible token mistake: the contract
       address is copied from the explorer or the asset list and
       pasted into the recipient field. Only the contract's own code
       can take tokens back, and that code is almost never there. */
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(TOKEN, '1')

    expect(await screen.findByText(/recipient is the token contract itself/i)).toBeInTheDocument()
  })

  it('explains where that mistake comes from', async () => {
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(TOKEN, '1')

    expect(await screen.findByText(/copied instead of the recipient address/i)).toBeInTheDocument()
  })

  it('an ordinary recipient does not trigger this warning', async () => {
    /* A false alarm trains people not to read warnings, and the
       real one will go unnoticed. */
    renderApp()
    await openSend()
    await selectSendAsset(/Select USDC on Ethereum/)
    await fillAndContinue(RECIPIENT, '1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText(/recipient is the token contract itself/i)).not.toBeInTheDocument()
  })

  it('sending native currency to the same address shows a different warning', async () => {
    /* Native currency sent to a contract is lost for a different
       reason and needs a different explanation: it has no contract,
       and "its own contract" is nonsense. */
    renderApp()
    await openSend()
    await fillAndContinue(TOKEN, '0.1')

    await screen.findByRole('heading', { name: 'Confirmation' })

    expect(screen.queryByText(/recipient is the token contract itself/i)).not.toBeInTheDocument()
  })
})

describe('Call check before signing', () => {
  it('a passed check is named a check of current state, not a promise', async () => {
    /* "The transaction will go through" is a promise the wallet
       cannot keep: between the check and inclusion the state
       changes. */
    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/ran this call without an error/i)).toBeInTheDocument()
    expect(screen.getByText(/It is not a promise/i)).toBeInTheDocument()
  })

  it('a revert is shown before signing together with the contract reason', async () => {
    /* Sending such a transaction would burn gas and yield nothing.
       The contract's own words say what to fix. */
    services.providerFactory.configure({
      balance: BALANCE,
      callRevert: { to: RECIPIENT, reason: 'the recipient is on a deny list' },
    })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/The call would fail/i)).toBeInTheDocument()
    expect(screen.getByText(/the recipient is on a deny list/i)).toBeInTheDocument()
  })

  it('a failed check is not presented as a successful one', async () => {
    /* Node silence confirms nothing, and wallet silence about that
       reads as "checked". */
    services.providerFactory.configure({ balance: BALANCE, callFails: true })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')

    expect(await screen.findByText(/could not be checked/i)).toBeInTheDocument()
    expect(screen.getByText(/not the same as a successful check/i)).toBeInTheDocument()
  })

  it('a failed check does not forbid the send', async () => {
    /* The owner of the funds decides: they may know about a
       counter-transaction the node has not seen yet. */
    services.providerFactory.configure({ balance: BALANCE, callFails: true })

    renderApp()
    await openSend()
    await fillAndContinue(RECIPIENT, '1')
    await screen.findByText(/could not be checked/i)

    expect(screen.getByRole('button', { name: 'Confirm and send' })).toBeEnabled()
  })
})

describe('Send: directory record', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('shows tokens from users.assets in the What to send list', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
          {
            chainId: '1',
            standard: 'ERC-20',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            balance: '2500000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    await openAssetSelect()
    expect(screen.getByRole('option', { name: /Select ETH on Ethereum/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Select USDC on Ethereum/ })).toBeInTheDocument()
    expect(screen.getByText(/Available/i)).toBeInTheDocument()
    expect(screen.getByText(/1\.2847 ETH/)).toBeInTheDocument()
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) => {
        const url = String(call[0])
        const method = call[1]?.method ?? 'GET'

        return method === 'GET' && url.includes('/v1/users/7')
      }),
    ).toBe(true)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText(/The transfer was recorded as pending/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Recipient address/)).toHaveValue('')
    expect(screen.getByLabelText(/Amount/)).toHaveValue('')

    const sendCall = vi.mocked(globalThis.fetch).mock.calls.find((call) =>
      String(call[0]).includes('/v1/users/sendings'),
    )
    expect(JSON.parse(String(sendCall?.[1]?.body))).toMatchObject({
      user_id: '7',
      email: 'theguy@email.com',
      recipient_address: RECIPIENT,
      amount: '0.5',
      symbol: 'ETH',
    })
  })

  it('updates Available after GET /v1/users/:id', async () => {
    const staleUser = {
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    }
    const freshUser = {
      ...staleUser,
      assets: {
        ...staleUser.assets,
        updatedAt: '2026-08-22T16:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native' as const,
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '832117000000000000',
            isVerified: true,
          },
        ],
      },
    }
    const directoryFetch = mockDirectoryAndPriceFetch(staleUser)

    globalThis.fetch = vi.fn((input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

      if (method === 'GET' && /\/v1\/users\/\d+/u.test(url)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(freshUser)),
          json: () => Promise.resolve(freshUser),
        }) as Promise<Response>
      }

      return directoryFetch(input, init)
    }) as typeof fetch

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    expect(await screen.findByText(/0\.832117 ETH/)).toBeInTheDocument()
    expect(screen.queryByText(/1\.2847 ETH/)).not.toBeInTheDocument()
  })

  it('shows failureMessage in the status panel when the SSE update matches the current send', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source).toBeDefined()

    source?.emit(
      'sendings',
      JSON.stringify({
        id: '1',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '7',
        status: 'failure',
        failureMessage: 'Blocked by admin',
        recipientAddress: RECIPIENT,
        amount: '0.5',
        symbol: 'ETH',
        type_send: 'update',
      }),
    )

    expect(await screen.findByText('failure')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('Blocked by admin')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows success in the status panel when the SSE update matches the current send', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()

    const source = TestEventSource.instances.find((item) => item.url.includes('/v1/sendings'))
    expect(source).toBeDefined()

    source?.emit(
      'sendings',
      JSON.stringify({
        id: '1',
        createdAt: '2026-08-22T14:59:14.037Z',
        userId: '7',
        status: 'success',
        failureMessage: null,
        recipientAddress: RECIPIENT,
        amount: '0.5',
        symbol: 'ETH',
        type_send: 'update',
      }),
    )

    expect(await screen.findByText('success')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('The transfer completed successfully.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('colors Available and blocks send when the amount exceeds the balance', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'theguy@email.com',
      theP: PASSWORD,
    })

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '2')

    expect(screen.getByText(/^Available/)).toHaveClass('text-destructive')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) =>
        String(call[0]).includes('/v1/users/sendings'),
      ),
    ).toBe(false)
  })

  it('takes user_id from etwallet.login-credentials.id even when it is a number', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: 70,
      email: 'theguy@email.com',
      balance: '70',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
        ],
      },
    })

    localStorage.setItem(
      LOGIN_CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        id: 70,
        email: 'theguy@email.com',
        the_p: PASSWORD,
      }),
    )

    renderApp()
    await openSend()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/Recipient address/), RECIPIENT)
    await user.type(screen.getByLabelText(/Amount/), '0.5')

    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)

    expect(await screen.findByRole('heading', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const sendCall = vi.mocked(globalThis.fetch).mock.calls.find((call) =>
      String(call[0]).includes('/v1/users/sendings'),
    )
    expect(JSON.parse(String(sendCall?.[1]?.body))).toMatchObject({
      user_id: '70',
      email: 'theguy@email.com',
      recipient_address: RECIPIENT,
      amount: '0.5',
      symbol: 'ETH',
    })
  })
})
