import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { writeLoginCredentials } from '@/features/onboarding'
import { shortenAddress } from '@/features/wallet'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  type ITestAppServices,
} from '@/test/doubles'
import {
  DISPLAY_CURRENCY,
  formatDisplayFiat,
} from '@/features/wallet/lib/display-currency'
import { appFiatRates } from '@/features/wallet/model/fiat-rates-cache'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** 1.5 of the native currency in its smallest units. */
const BALANCE = 1_500_000_000_000_000_000n as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/**
 * Waits until the dashboard chrome appears.
 *
 * The signal is the active account name in the shell header: it shows
 * only after the session is open and the account is derived from the
 * seed phrase.
 */
async function findDashboard(): Promise<HTMLElement> {
  return await screen.findByText('Account 1')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Dashboard: balance', () => {
  it('shows the native-currency balance of the active network', async () => {
    renderApp()
    await findDashboard()

    expect((await screen.findAllByText('1.5')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ETH').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Mirror' })).not.toBeInTheDocument()
  })

  it('names that the native-currency balance is shown and links to portfolio', async () => {
    renderApp()
    await findDashboard()

    /* The old caveat "ERC-20 balances are not tracked" is obsolete:
       tokens are tracked. A warning about a limit that does not exist
       trains people not to read the others. */
    expect(
      await screen.findByText(/The native currency of the network is sent here/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /portfolio/i })).toBeInTheDocument()
  })

  it('does not replace an unavailable balance with zero', async () => {
    services.providerFactory.configure({ unavailable: true })

    renderApp()
    await findDashboard()

    expect(await screen.findByText(/that does not mean the funds\s+are gone/i)).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})

describe('Dashboard: header', () => {
  it('shows the active account address shortened', async () => {
    renderApp()
    await findDashboard()

    const expected = TEST_MNEMONIC_ADDRESSES[0] as string
    const shortened = `${expected.slice(0, 6)}…${expected.slice(-6)}`

    expect(screen.getByText(shortened)).toBeInTheDocument()
  })

  it('shows the address fingerprint', async () => {
    renderApp()
    await findDashboard()

    /* The fingerprint depends on every character of the address: a
       swapped address changes the picture entirely, which is visible
       without reading the hex. */
    expect(screen.getByRole('img', { name: 'Address fingerprint' })).toBeInTheDocument()
  })

  it('names the active network next to the amount', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getAllByText('Ethereum')).toHaveLength(1)
  })
})

describe('Dashboard: activity', () => {
  it('explains an empty history instead of skipping it silently', async () => {
    renderApp()
    await findDashboard()

    expect(await screen.findByText('No operations yet')).toBeInTheDocument()
    expect(screen.getByText(/the limits of the\s+source/i)).toBeInTheDocument()
  })

  it('links to the full activity list', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getByRole('link', { name: /all activity/i })).toBeInTheDocument()
  })

  it('places the assets showcase and the rates table before recent activity', async () => {
    renderApp()
    await findDashboard()

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(await screen.findByText('Ether')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all assets/i })).toHaveAttribute(
      'href',
      '/wallet/assets',
    )
    expect(screen.getByRole('heading', { name: 'Cryptocurrency Prices' })).toBeInTheDocument()
  })

  it('shows asset details after a tap on the home screen', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()
    await screen.findByText('Ether')

    await user.click(screen.getByRole('button', { name: 'ETH on Ethereum — asset details' }))

    expect(screen.getByText('Native currency')).toBeInTheDocument()
    expect(screen.getByText('No contract — native currency of the network')).toBeInTheDocument()
  })
})

describe('Dashboard: quick actions', () => {
  it('links to the send screen', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getByRole('link', { name: /send/i })).toHaveAttribute('href', '/wallet/send')
  })

  it('names that native currency is sent, not tokens', async () => {
    renderApp()
    await findDashboard()

    /* On an ERC-20 transfer the recipient lives in the call data, not
       in the transaction `to` field: collapsing both into one form
       would show the user something other than what they sign. */
    expect(screen.getByText(/The native currency of the network is sent here/i)).toBeInTheDocument()
  })

  it('shows the full receive address, not a shortened one', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('button', { name: /Receive/i }))

    /* A shortened address cannot be checked character by character,
       and that check is what protects against clipboard swap. */
    expect(screen.getByText(TEST_MNEMONIC_ADDRESSES[0] as string)).toBeInTheDocument()
    expect(screen.getByText(/Check the address\s+character by character/i)).toBeInTheDocument()
  })

  it('locks the wallet and returns to the password screen', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('button', { name: 'Lock the wallet' }))

    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })
})

/**
 * Moving between screens must be noticeable to more than the eyes.
 *
 * Without a focus move, tapping a nav item swapped the content while
 * focus stayed on the link, and a listener heard nothing: the
 * transition existed only for sighted users.
 */
describe('Dashboard: moving between screens', () => {
  it('does not steal focus when the app opens', async () => {
    renderApp()
    await findDashboard()

    /* The person has not navigated yet. Hijacking focus would throw
       off someone already tabbing through the page. */
    expect(document.activeElement).not.toBe(document.querySelector('main'))
  })

  it('moves focus into the content after navigation', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))
    await screen.findByRole('heading', { level: 1, name: 'Assets' })

    /* Focus the content region, not the heading: not every screen has
       a heading, the region always exists, and a screen reader starts
       reading it from the top. */
    expect(document.activeElement).toBe(document.querySelector('main'))
  })
})

describe('Dashboard: directory cabinet', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('shows fiat, not ether, after both creation and sign-in', async () => {
    /* Thin fetch: no market catalog. The shared stub hydrates coins,
       and ETH appears on the dashboard — exactly what must not happen
       here. */
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      const body =
        method.toUpperCase() === 'GET' && /\/v1\/users\/\d+\/sendings/u.test(url)
          ? { sendings: [] }
          : {
              id: '7',
              email: 'james@example.com',
              balance: '12.5',
              createdAt: '2026-08-19T12:00:00.000Z',
            }

      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    }) as unknown as typeof fetch

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$12.50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send/i })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mirror' })).not.toBeInTheDocument()
    expect(screen.queryByText('1.5')).not.toBeInTheDocument()
    expect(screen.queryByText('ETH')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(screen.getByText('No assets yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Receive/i })).toBeEnabled()
    expect((await screen.findAllByText('Account 1')).length).toBeGreaterThan(0)
  })

  it('converts the fiat balance to euros at the source rate', async () => {
    const user = userEvent.setup()

    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'james@example.com',
      balance: '12.5',
      createdAt: '2026-08-19T12:00:00.000Z',
    })
    appFiatRates.reset()

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$12.50')).toBeInTheDocument()

    await waitFor(() => {
      expect(appFiatRates.getSnapshot().EUR).not.toBe(1)
    })

    const eurAmount = formatDisplayFiat(
      12.5,
      DISPLAY_CURRENCY.Eur,
      appFiatRates.getSnapshot(),
    )

    await user.click(screen.getByRole('radio', { name: 'EUR' }))

    expect(await screen.findByText(eurAmount)).toBeInTheDocument()
  })

  it('shows tokens from users.assets on the home screen', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'james@example.com',
      balance: '0',
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
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$6,719.11')).toBeInTheDocument()
    expect(screen.getByText('Ether')).toBeInTheDocument()
    expect(screen.getAllByText('USD Coin').length).toBeGreaterThan(0)
    expect(screen.getByText('1.2847 ETH')).toBeInTheDocument()
    expect(screen.getByText('2500 USDC')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all assets/i })).toHaveAttribute(
      'href',
      '/wallet/assets',
    )
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) => {
        const url = String(call[0])
        const method = call[1]?.method ?? 'GET'

        return method === 'GET' && url.includes('/v1/users/7')
      }),
    ).toBe(true)
  })

  it('shows sendings from GET /v1/users/:id/sendings on the home screen after sign-in', async () => {
    const recipient = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

    globalThis.fetch = mockDirectoryAndPriceFetch(
      {
        id: '7',
        email: 'james@example.com',
        balance: '12.5',
        createdAt: '2026-08-19T12:00:00.000Z',
      },
      {
        sendings: [
          {
            id: '61',
            createdAt: '2026-08-22T14:44:10.949Z',
            userId: '7',
            status: 'success',
            failureMessage: null,
            recipientAddress: recipient,
            amount: '2',
            symbol: 'USDT',
          },
          {
            id: '62',
            createdAt: '2026-08-22T15:00:00.000Z',
            userId: '7',
            status: 'failure',
            failureMessage: 'Blocked by admin',
            recipientAddress: recipient,
            amount: '1',
            symbol: 'USDT',
          },
        ],
      },
    )

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$12.50')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument()
    expect(await screen.findByText('2 USDT')).toBeInTheDocument()
    expect(screen.getByText('1 USDT')).toBeInTheDocument()
    expect(screen.getByText('Blocked by admin')).toBeInTheDocument()
    expect(screen.getAllByText(shortenAddress(recipient)).length).toBeGreaterThan(0)
    expect(screen.getByText('success')).toBeInTheDocument()
    expect(screen.getByText('failure')).toBeInTheDocument()
    expect(screen.queryByText('No operations yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) => {
        const url = String(call[0])
        const method = call[1]?.method ?? 'GET'

        return method === 'GET' && /\/v1\/users\/\d+\/sendings/u.test(url)
      }),
    ).toBe(true)
  })
})
