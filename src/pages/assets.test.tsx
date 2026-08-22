import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { writeLoginCredentials, type IRemoteAssets } from '@/features/onboarding'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  type ITestAppServices,
} from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** Витрина записи справочника, которую экран активов показывает как есть. */
const STORED_ASSETS: IRemoteAssets = {
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
    {
      chainId: '1',
      standard: 'ERC-20',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      balance: '1800500000',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: 'ERC-20',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      balance: '400000000000000000000',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: 'ERC-20',
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      balance: '4200000',
      isVerified: true,
    },
    {
      chainId: '1',
      standard: 'ERC-20',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      balance: '750000000000000000',
      isVerified: true,
    },
    {
      chainId: '10',
      standard: 'ERC-20',
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      balance: '320250000',
      isVerified: true,
    },
    {
      chainId: '10',
      standard: 'ERC-20',
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      balance: '120000000000000000',
      isVerified: true,
    },
  ],
}

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

const originalFetch = globalThis.fetch

beforeEach(async () => {
  window.location.hash = ''
  localStorage.clear()
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

  globalThis.fetch = mockDirectoryAndPriceFetch({
    id: '7',
    email: 'james@example.com',
    balance: '0',
    createdAt: '2026-08-19T12:00:00.000Z',
    wallets: [{ key: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', value: '0' }],
    assets: STORED_ASSETS,
  })

  writeLoginCredentials({
    id: '7',
    email: 'james@example.com',
    theP: PASSWORD,
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  localStorage.clear()
})

describe('Активы записи справочника', () => {
  it('показывает все токены из users.assets, а не один ETH с нулём', async () => {
    const user = userEvent.setup()

    renderApp()
    expect(await screen.findByText('Ether')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Assets' }))
    await screen.findByRole('heading', { name: 'Assets' })

    expect(screen.getByText('Ether')).toBeInTheDocument()
    expect(screen.getByText('Tether USD')).toBeInTheDocument()
    expect(screen.getByText('Dai Stablecoin')).toBeInTheDocument()
    expect(screen.getByText('Wrapped BTC')).toBeInTheDocument()
    expect(screen.getAllByText('USD Coin')).toHaveLength(2)
    expect(screen.getAllByText('Wrapped Ether')).toHaveLength(2)

    expect(screen.getByText('1.2847')).toBeInTheDocument()
    expect(screen.getByText('2500')).toBeInTheDocument()
    expect(screen.getByText('1800.5')).toBeInTheDocument()
    expect(screen.getByText('400')).toBeInTheDocument()
    expect(screen.getByText('0.042')).toBeInTheDocument()
    expect(screen.getByText('0.75')).toBeInTheDocument()
    expect(screen.getByText('320.25')).toBeInTheDocument()
    expect(screen.getByText('0.12')).toBeInTheDocument()

    expect(await screen.findByText('≈ $4,219.11')).toBeInTheDocument()
    expect(screen.getByText('≈ $2,500.00')).toBeInTheDocument()
    expect(screen.getByText('≈ $394.09')).toBeInTheDocument()

    expect(screen.queryByText('Asset value in fiat is not shown')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import a token/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/stored with the account record/i)).not.toBeInTheDocument()
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some((call) => {
        const url = String(call[0])
        const method = call[1]?.method ?? 'GET'

        return method === 'GET' && url.includes('/v1/users/7')
      }),
    ).toBe(true)
  })
})
