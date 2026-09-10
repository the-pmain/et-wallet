import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { priceRefKey, toAddress, toChainId, type IPriceQuote, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** Two ether. */
const BALANCE = 2_000_000_000_000_000_000n as Wei

const ETHEREUM = toChainId(1n)

const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Ether quote: price and daily change. */
const ETH_QUOTE: IPriceQuote = {
  price: 2000,
  change24hPercent: 10,
  updatedAt: 1_700_000_000_000 as IPriceQuote['updatedAt'],
}

const USDC_QUOTE: IPriceQuote = {
  price: 1,
  change24hPercent: 0,
  updatedAt: 1_700_000_000_000 as IPriceQuote['updatedAt'],
}

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openPortfolio(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: /portfolio/i }))
  await screen.findByRole('heading', { name: 'Portfolio', level: 1 })
}

async function enablePrices(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /Show the value/i }))
  await screen.findByText('Allocation')
}

/** Quotes for the native currency only. */
function nativeOnly(): ReadonlyMap<string, IPriceQuote> {
  return new Map([[priceRefKey({ chainId: ETHEREUM, address: null }), ETH_QUOTE]])
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })
  services.priceProvider.configure({ quotes: nativeOnly() })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Portfolio: consent to the price source', () => {
  it('without consent the value is not shown', async () => {
    renderApp()
    await openPortfolio()

    expect(screen.getByText('Portfolio value is turned off')).toBeInTheDocument()
  })

  it('without consent the price source is never queried', async () => {
    /* A rate request tells the service the contract address, that is
       the portfolio composition. Before consent that request must not
       exist. */
    renderApp()
    await openPortfolio()

    expect(services.priceProvider.callCount).toBe(0)
  })

  it('lists exactly what the service will learn', async () => {
    /* Consent given for a vague "better experience" is not consent:
       a person cannot decide about what they were not told. */
    renderApp()
    await openPortfolio()

    expect(screen.getByText(/the composition of the portfolio/i)).toBeInTheDocument()
    expect(screen.getByText(/IP address/i)).toBeInTheDocument()
  })

  it('names that the wallet address is not sent', async () => {
    renderApp()
    await openPortfolio()

    expect(screen.getByText(/your wallet address — it is never sent/i)).toBeInTheDocument()
  })

  it('the value appears after consent', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* Two ether at 2000 is four thousand. The figure appears three
       times: the total, the allocation share, and the asset row. */
    expect(screen.getAllByText(/\$4,000\.00/u).length).toBeGreaterThan(0)
  })

  it('consent survives a session restart', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    await services.session.close()
    await services.session.open()

    await waitFor(() => {
      expect(services.session.getSnapshot().arePricesEnabled).toBe(true)
    })
  })
})

describe('Portfolio: value and change', () => {
  beforeEach(async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()
  })

  it('shows the daily change as a percent', () => {
    /* Shown both for the whole portfolio and on the asset row. */
    expect(screen.getAllByText('+10.00 %').length).toBeGreaterThan(0)
  })

  it('notes that the change is computed from rates, not from holdings', () => {
    /* Buying an asset raises portfolio value, but that is not a
       price rise, and it must not be credited as income. */
    expect(screen.getByText(/with an unchanged composition/i)).toBeInTheDocument()
  })

  it('shows the previous-day valuation', () => {
    /* Four thousand after a 10% rise means yesterday was 3636.36. */
    expect(screen.getByText(/\$3,636\.36/u)).toBeInTheDocument()
  })
})

describe('Portfolio: allocation', () => {
  it('draws a chart with a text description', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* A chart without a text description is unavailable to someone
       who listens to the page instead of looking at it. */
    expect(screen.getByRole('img', { name: /ETH 100/u })).toBeInTheDocument()
  })

  it('duplicates the chart with a numbered list', async () => {
    /* 18% vs 22% is invisible on the ring, and color as the only
       cue is unavailable to people with impaired color vision. */
    renderApp()
    await openPortfolio()
    await enablePrices()

    const allocation = screen.getByText('Allocation').closest('[data-slot=card]') as HTMLElement

    expect(within(allocation).getByText('100.0 %')).toBeInTheDocument()
  })
})

describe('Portfolio: unknown is not replaced with zero', () => {
  beforeEach(() => {
    /* The token is added, but the source does not know its rate. */
    services.priceProvider.configure({ quotes: nativeOnly() })
  })

  it('a position without a rate is left out of the total but stays in the list', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    /* There is one native currency; the total is only from it. */
    expect(screen.getAllByText(/\$4,000\.00/u).length).toBeGreaterThan(0)
  })

  it('reports positions that were left out of the valuation', async () => {
    services.priceProvider.configure({ quotes: new Map() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/without a known price/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/does not mean they are worthless/i)).toBeInTheDocument()
  })

  it('does not blame the source when the portfolio simply had no value', async () => {
    /* The rate is known, but yesterday's value is zero, so the
       percent is undefined. "The source did not report a change"
       would credit the service with something it did not do. */
    services.providerFactory.configure({ balance: 0n as Wei })
    services.priceProvider.configure({ quotes: nativeOnly() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/was worth nothing/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/the source reported none/i)).not.toBeInTheDocument()
  })

  it('with no rates at all shows a dash, not a zero total', async () => {
    /* "$0.00" here would tell the owner their assets are
       worthless, when the wallet received no rates. */
    services.priceProvider.configure({ quotes: new Map() })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText(/the value was not calculated/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/^\$0\.00$/u)).not.toBeInTheDocument()
  })
})

describe('Portfolio: source failure', () => {
  it('does not present a failure as a zero total', async () => {
    services.priceProvider.configure({ failure: 'Too many requests' })

    renderApp()
    await openPortfolio()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /Show the value/i }))

    await waitFor(() => {
      expect(screen.getByText('Prices could not be fetched')).toBeInTheDocument()
    })
    expect(screen.getByText(/does not mean the rest are\s+worthless/i)).toBeInTheDocument()
  })
})

describe('Portfolio: stats', () => {
  it('notes that the valuation is not used to build a transaction', async () => {
    renderApp()
    await openPortfolio()
    await enablePrices()

    expect(screen.getByText(/counted\s+in the minimal units of the network/i)).toBeInTheDocument()
  })

  it('names the price source', async () => {
    /* The user has a right to know who receives their requests. */
    renderApp()
    await openPortfolio()
    await enablePrices()

    expect(screen.getByText(/Price double/u)).toBeInTheDocument()
  })
})

describe('Portfolio: entry from the home screen', () => {
  it('the link goes to the portfolio', async () => {
    /* Portfolio is not in the bottom bar: five items is the limit
       for a 360-pixel window. */
    renderApp()
    await screen.findByText('Account 1')

    expect(screen.getByRole('link', { name: /portfolio/i })).toHaveAttribute(
      'href',
      '/wallet/portfolio',
    )
  })

  it('USDC is not in the valuation if its rate is unknown', async () => {
    services.priceProvider.configure({
      quotes: new Map([
        [priceRefKey({ chainId: ETHEREUM, address: null }), ETH_QUOTE],
        [priceRefKey({ chainId: ETHEREUM, address: USDC }), USDC_QUOTE],
      ]),
    })

    renderApp()
    await openPortfolio()
    await enablePrices()

    /* USDC was not added to the wallet: there is a quote but no
       position, and it must not appear in the list. */
    expect(screen.queryByText('USDC')).not.toBeInTheDocument()
  })
})
