import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  TOKEN_STANDARD,
  appMarketCatalog,
  buildPortfolio,
  priceRefKey,
  toAddress,
  toChainId,
  type Address,
  type IPortfolioSummary,
  type IToken,
  type Timestamp,
} from '@/core'

import type { ITokenBalance } from '../model/contracts'
import { DisplayCurrencyProvider } from '../model/display-currency-context'
import { TokenList } from './TokenList'

const CHAIN_ID = toChainId(1n)
const OTHER_CHAIN_ID = toChainId(56n)

const NOW = 1_785_000_000_000 as Timestamp

function token(symbol: string, decimals: number, address: string | null): IToken {
  return {
    chainId: CHAIN_ID,
    address: address === null ? null : toAddress(address),
    standard: address === null ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol,
    name: symbol,
    decimals,
    logoUri: null,
    isCustom: false,
    isVerified: true,
    addedAt: NOW,
  }
}

const ETH = token('ETH', 18, null)
const USDC = token('USDC', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const ETHER = 10n ** 18n

/** Summary for the given rates. Tokens without an entry stay unquoted. */
function portfolioWith(entries: readonly (readonly [IToken, number])[]): IPortfolioSummary {
  return buildPortfolio(
    [
      { token: ETH, balance: 2n * ETHER },
      { token: USDC, balance: 50n * 10n ** 6n },
    ],
    new Map(
      entries.map(([item, price]) => [
        priceRefKey({ chainId: item.chainId, address: item.address }),
        { price, change24hPercent: null, updatedAt: NOW },
      ]),
    ),
  )
}

const BALANCES: readonly ITokenBalance[] = [
  { token: ETH, balance: 2n * ETHER },
  { token: USDC, balance: 50n * 10n ** 6n },
]

function renderList(
  portfolio: IPortfolioSummary | null,
  tokens: readonly ITokenBalance[] = BALANCES,
  onRemove: ((address: Address) => void) | null = () => undefined,
) {
  return render(
    <DisplayCurrencyProvider>
      <TokenList
        tokens={tokens}
        isLoading={false}
        portfolio={portfolio}
        {...(onRemove === null ? {} : { onRemove })}
      />
    </DisplayCurrencyProvider>,
  )
}

describe('TokenList: dollar estimate', () => {
  it('shows an estimate for each row with a known rate', () => {
    renderList(
      portfolioWith([
        [ETH, 3000],
        [USDC, 1],
      ]),
    )

    expect(screen.getByText('≈ $6,000.00')).toBeInTheDocument()
    expect(screen.getByText('≈ $50.00')).toBeInTheDocument()
  })

  it('leaves a row without a rate unestimated, not as zero', () => {
    /* "$0.00" under a non-empty balance reads as "this asset is
       worthless", when the wallet simply does not know the rate. */
    renderList(portfolioWith([[ETH, 3000]]))

    expect(screen.getByText('≈ $6,000.00')).toBeInTheDocument()
    expect(screen.queryByText('≈ $0.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$50/u)).not.toBeInTheDocument()
  })

  it('shows no estimate at all without price consent', () => {
    renderList(null)

    expect(screen.queryByText(/≈/u)).not.toBeInTheDocument()
  })

  it('does not value against another chain\'s rates', () => {
    /* Gap while switching chains: the list is already the new chain,
       the summary is still the old one. Without a match, two ether
       would be valued at the BNB rate. */
    const foreignEth: IToken = { ...ETH, chainId: OTHER_CHAIN_ID }
    const foreignUsdc: IToken = { ...USDC, chainId: OTHER_CHAIN_ID }

    renderList(
      portfolioWith([
        [ETH, 3000],
        [USDC, 1],
      ]),
      [
        { token: foreignEth, balance: 2n * ETHER },
        { token: foreignUsdc, balance: 50n * 10n ** 6n },
      ],
    )

    expect(screen.queryByText(/≈/u)).not.toBeInTheDocument()
  })

  it('values each row on its own chain, not one shared rate', () => {
    const optimismUsdc: IToken = {
      ...USDC,
      chainId: toChainId(10n),
      address: toAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    }

    renderList(
      buildPortfolio(
        [
          { token: ETH, balance: 2n * ETHER },
          { token: optimismUsdc, balance: 50n * 10n ** 6n },
        ],
        new Map([
          [
            priceRefKey({ chainId: ETH.chainId, address: ETH.address }),
            { price: 3000, change24hPercent: null, updatedAt: NOW },
          ],
          [
            priceRefKey({ chainId: optimismUsdc.chainId, address: optimismUsdc.address }),
            { price: 1, change24hPercent: null, updatedAt: NOW },
          ],
        ]),
      ),
      [
        { token: ETH, balance: 2n * ETHER },
        { token: optimismUsdc, balance: 50n * 10n ** 6n },
      ],
    )

    expect(screen.getByText('≈ $6,000.00')).toBeInTheDocument()
    expect(screen.getByText('≈ $50.00')).toBeInTheDocument()
  })

  it('shows native currency of two chains as two rows', () => {
    const optimismEth: IToken = { ...ETH, chainId: toChainId(10n), name: 'Ether on Optimism' }

    renderList(null, [
      { token: ETH, balance: 1n * ETHER },
      { token: optimismEth, balance: 2n * ETHER },
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('1 ETH')).toBeInTheDocument()
    expect(screen.getByText('2 ETH')).toBeInTheDocument()
  })

  it('hides the remove button when there is no handler', () => {
    renderList(null, BALANCES, null)

    expect(screen.queryByRole('button', { name: /Remove token/i })).not.toBeInTheDocument()
  })

  it('keeps the quantity as the row\'s primary figure', () => {
    /* The real amount is the coin figure: it is exact and signed.
       The estimate must not displace it. */
    renderList(portfolioWith([[ETH, 3000]]))

    const amount = screen.getByText('2 ETH')
    const value = screen.getByText('≈ $6,000.00')

    expect(amount.className).toContain('font-semibold')
    expect(value.className).toContain('text-xs')
  })
})

describe('TokenList: asset details', () => {
  it('expands native currency without a contract address', async () => {
    const user = userEvent.setup()

    renderList(
      portfolioWith([
        [ETH, 3000],
        [USDC, 1],
      ]),
    )

    expect(screen.queryByText('Native currency')).not.toBeInTheDocument()

    const ethRow = screen.getByRole('button', { name: 'ETH on Ethereum — asset details' })

    expect(ethRow).toHaveAttribute('aria-expanded', 'false')

    await user.click(ethRow)

    expect(ethRow).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Native currency')).toBeInTheDocument()
    expect(screen.getByText('No contract — native currency of the network')).toBeInTheDocument()
    expect(screen.getByText('Ethereum')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Ethereum explorer' })).toHaveAttribute(
      'href',
      'https://etherscan.io',
    )
    expect(screen.queryByText(USDC.address as string)).not.toBeInTheDocument()
  })

  it('expands an ERC-20 contract with the full address and rate', async () => {
    const user = userEvent.setup()

    renderList(
      buildPortfolio(
        [
          { token: ETH, balance: 2n * ETHER },
          { token: USDC, balance: 50n * 10n ** 6n },
        ],
        new Map([
          [
            priceRefKey({ chainId: ETH.chainId, address: ETH.address }),
            { price: 3000, change24hPercent: null, updatedAt: NOW },
          ],
          [
            priceRefKey({ chainId: USDC.chainId, address: USDC.address }),
            { price: 1, change24hPercent: -0.42, updatedAt: NOW },
          ],
        ]),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'USDC on Ethereum — asset details' }))

    expect(screen.getByText('ERC-20')).toBeInTheDocument()
    expect(screen.getByText(USDC.address as string)).toBeInTheDocument()
    expect(screen.getByText('-0.42 %')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in Ethereum explorer' })).toHaveAttribute(
      'href',
      `https://etherscan.io/token/${USDC.address as string}`,
    )
    expect(screen.getByRole('button', { name: 'Copy USDC contract address' })).toBeInTheDocument()
  })

  it('a second click closes the panel', async () => {
    const user = userEvent.setup()

    renderList(null)

    const ethRow = screen.getByRole('button', { name: 'ETH on Ethereum — asset details' })

    await user.click(ethRow)
    expect(screen.getByText('Native currency')).toBeInTheDocument()

    await user.click(ethRow)
    expect(ethRow).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Native currency')).not.toBeInTheDocument()
  })

  it('remove does not expand the row', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()

    renderList(null, BALANCES, onRemove)

    await user.click(screen.getByRole('button', { name: 'Remove token USDC' }))

    expect(onRemove).toHaveBeenCalledWith(USDC.address)
    expect(screen.queryByText('ERC-20')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'USDC on Ethereum — asset details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('draws a price chart from the catalog series', async () => {
    const user = userEvent.setup()

    appMarketCatalog.hydrate([
      {
        id: 'ethereum',
        symbol: 'ETH',
        name: 'Ethereum',
        rank: 2,
        priceUsd: 3000,
        change1hPercent: 0,
        change24hPercent: 1.2,
        change7dPercent: 3,
        volume24hUsd: 1,
        marketCapUsd: 2,
        sparkline7d: [2900, 2950, 3000, 2980, 3020],
      },
    ])

    renderList(portfolioWith([[ETH, 3000]]))

    await user.click(screen.getByRole('button', { name: 'ETH on Ethereum — asset details' }))

    expect(screen.getByRole('img', { name: /ETH price, last 24 hours/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24H' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '7D' }))

    expect(screen.getByRole('img', { name: /ETH price, last 7 days/i })).toBeInTheDocument()
  })

  it('keeps several rows expanded at once', async () => {
    const user = userEvent.setup()

    renderList(null)

    await user.click(screen.getByRole('button', { name: 'ETH on Ethereum — asset details' }))
    await user.click(screen.getByRole('button', { name: 'USDC on Ethereum — asset details' }))

    expect(screen.getByText('Native currency')).toBeInTheDocument()
    expect(screen.getByText('ERC-20')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
