import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import {
  TOKEN_STANDARD,
  buildPortfolio,
  priceRefKey,
  toChainId,
  toWei,
  type IBalance,
  type INetworkConfig,
  type IPortfolioSummary,
  type IToken,
  type Timestamp,
} from '@/core'
import { I18nProvider } from '@/app/providers/I18nProvider'

import { DisplayCurrencyProvider } from '../model/display-currency-context'
import { BalanceCard } from './BalanceCard'

const CHAIN_ID = toChainId(1n)

const NOW = 1_785_000_000_000 as Timestamp

const NETWORK = {
  chainId: 1n,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [],
  blockExplorerUrls: [],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
} as unknown as INetworkConfig

const ETH: IToken = {
  chainId: CHAIN_ID,
  address: null,
  standard: TOKEN_STANDARD.Native,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  logoUri: null,
  isCustom: false,
  isVerified: true,
  addedAt: NOW,
}

/** Whole ether: `balanceOf(2n)` is two ether, not two wei. */
const ETHER = 10n ** 18n

function balanceOf(raw: bigint): IBalance {
  return {
    raw: toWei(raw * ETHER),
    decimals: 18,
    chainId: CHAIN_ID,
    isStale: false,
  } as unknown as IBalance
}

/** Summary with a known ether rate. */
function portfolioAt(price: number, balance = 1n): IPortfolioSummary {
  return buildPortfolio(
    [{ token: ETH, balance: toWei(balance * ETHER) }],
    new Map([
      [
        priceRefKey({ chainId: CHAIN_ID, address: null }),
        { price, change24hPercent: null, updatedAt: NOW },
      ],
    ]),
  )
}

interface Options {
  readonly isLoading?: boolean
  readonly portfolio?: IPortfolioSummary | null
  readonly arePricesEnabled?: boolean
  readonly isPortfolioLoading?: boolean
}

function card(balance: IBalance | null, options: Options = {}) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <DisplayCurrencyProvider>
          <BalanceCard
            balance={balance}
            network={NETWORK}
            isLoading={options.isLoading ?? false}
            error={null}
            onRefresh={() => undefined}
            portfolio={options.portfolio ?? null}
            arePricesEnabled={options.arePricesEnabled ?? false}
            isPortfolioLoading={options.isPortfolioLoading ?? false}
          />
        </DisplayCurrencyProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

function renderCard(balance: IBalance | null, options: Options = {}) {
  return render(card(balance, options))
}

/** Node that holds the amount: it comes first and carries the large type size. */
function amountNode(): HTMLElement {
  return document.querySelector('[data-slot=card-content] p.text-4xl') as HTMLElement
}

/**
 * Amount motion means A DIFFERENT VALUE ARRIVED.
 *
 * Checked by a test, not by eye: the browser preview in this
 * environment does not paint frames, so the animation always sits at
 * zero. Presence or absence of enter classes is what can be asserted
 * reliably.
 */
describe('BalanceCard: amount appear', () => {
  it('does not animate on first paint', () => {
    renderCard(balanceOf(5n))

    /* The screen is already entering as a whole. A second enter on
       the largest object on top of the first reads as flicker. */
    expect(amountNode().className).not.toContain('animate-in')
  })

  it('animates when a different value arrived', () => {
    const view = renderCard(balanceOf(5n))

    view.rerender(card(balanceOf(7n)))

    expect(amountNode().className).toContain('animate-in')
  })

  it('does not animate when the amount is unchanged', () => {
    const view = renderCard(balanceOf(5n))

    /* The session recreates the balance object on every refresh.
       Compare the value, not the reference, or every node poll would
       flicker. */
    view.rerender(card(balanceOf(5n)))

    expect(amountNode().className).not.toContain('animate-in')
  })

  it('marks the region busy while the amount refreshes', () => {
    renderCard(balanceOf(5n), { isLoading: true })

    /* The spinning icon is the only work cue for a sighted user;
       for a listener this mark is that cue. */
    const content = document.querySelector('[data-slot=card-content]')

    expect(content?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByLabelText('Refresh the balance')).toBeDisabled()
  })
})

describe('BalanceCard: dollar estimate', () => {
  it('shows an estimate of the displayed amount', () => {
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.getByText('approximately $6,000.00')).toBeInTheDocument()
  })

  it('values the fresh amount, not the one the summary was computed from', () => {
    /* Refreshing the balance does not recompute the portfolio. A
       ready summary value would describe the previous amount sitting
       right under the new one. */
    renderCard(balanceOf(5n), {
      arePricesEnabled: true,
      portfolio: portfolioAt(3000, 2n),
    })

    expect(screen.getByText('approximately $15,000.00')).toBeInTheDocument()
  })

  it('without consent offers a link instead of fetching rates', () => {
    /* A price-source request reveals the portfolio. Consent is taken
       on the portfolio screen, where what leaves is listed; here it
       is only a link there. */
    renderCard(balanceOf(2n), { arePricesEnabled: false, portfolio: portfolioAt(3000) })

    expect(screen.getByRole('link', { name: /show the value in dollars/iu })).toHaveAttribute(
      'href',
      '/wallet/portfolio',
    )
    expect(screen.queryByText(/approximately/iu)).not.toBeInTheDocument()
  })

  it('does not substitute zero when the rate is unknown', () => {
    /* The most dangerous swap here: "$0.00" under a non-empty
       balance reads as "the funds are worthless". */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: null })

    expect(screen.getByText('The value could not be estimated')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00/u)).not.toBeInTheDocument()
  })

  it('does not declare the estimate unavailable while rates are loading', () => {
    renderCard(balanceOf(2n), {
      arePricesEnabled: true,
      portfolio: null,
      isPortfolioLoading: true,
    })

    expect(screen.getByText('Estimating the value…')).toBeInTheDocument()
    expect(screen.queryByText('The value could not be estimated')).not.toBeInTheDocument()
  })

  it('shows the quote time next to the estimate', () => {
    /* The rate polls once a minute, but a source failure leaves the
       previous figure. Only the time tells live from frozen. */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.getByText(/^Rate as of \d{1,2}:\d{2}/u)).toBeInTheDocument()
  })

  it('does not invent a time when the quote instant is unknown', () => {
    /* Substituting the current time would label unknown data as
       fresh. */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: null })

    expect(screen.queryByText(/Rate as of/u)).not.toBeInTheDocument()
  })

  it('takes no space without a balance', () => {
    renderCard(null, { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.queryByText(/approximately/iu)).not.toBeInTheDocument()
    expect(screen.queryByText('The value could not be estimated')).not.toBeInTheDocument()
  })
})
