import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { IMarketCoin } from '@/core'
import { I18nProvider } from '@/app/providers/I18nProvider'

import { MARKET_PREVIEW_COUNT, MarketPricesCard, type MarketPricesLoader } from './MarketPricesCard'

const BITCOIN: IMarketCoin = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  rank: 1,
  priceUsd: 71_947.59,
  change1hPercent: 0,
  change24hPercent: 11.5,
  change7dPercent: 13.4,
  volume24hUsd: 66_358_006_353,
  marketCapUsd: 1_444_080_308_589,
}

function coinAt(index: number): IMarketCoin {
  return {
    id: `coin-${String(index)}`,
    symbol: `C${String(index)}`,
    name: `Coin ${String(index)}`,
    rank: index,
    priceUsd: index,
    change1hPercent: index % 2 === 0 ? -0.4 : 1.2,
    change24hPercent: 2.0,
    change7dPercent: 3.0,
    volume24hUsd: 1_000,
    marketCapUsd: 2_000,
  }
}

function renderCard(loadMarkets: MarketPricesLoader) {
  return render(
    <I18nProvider>
      <MarketPricesCard loadMarkets={loadMarkets} />
    </I18nProvider>,
  )
}

describe('MarketPricesCard', () => {
  it('запрашивает рынок при появлении и рисует строку без графика', async () => {
    const loadMarkets = vi.fn<MarketPricesLoader>().mockResolvedValue([BITCOIN])

    renderCard(loadMarkets)

    expect(loadMarkets).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('heading', { name: 'Cryptocurrency Prices' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    expect(screen.getByText('BTC')).toBeInTheDocument()
    expect(screen.getByText('$71,947.59')).toBeInTheDocument()
    expect(screen.getByText('$66,358,006,353')).toBeInTheDocument()
    expect(screen.getByText('11.5%')).toBeInTheDocument()
    expect(screen.queryByText('Last 7 Days')).not.toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
  })

  it('прячет хвост списка за Show more', async () => {
    const user = userEvent.setup()
    const coins = Array.from({ length: MARKET_PREVIEW_COUNT + 4 }, (_, index) => coinAt(index + 1))
    const hidden = coins[MARKET_PREVIEW_COUNT]

    renderCard(vi.fn<MarketPricesLoader>().mockResolvedValue(coins))

    expect(await screen.findByText('Coin 1')).toBeInTheDocument()
    expect(screen.queryByText(hidden?.name ?? '')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(screen.getByText(hidden?.name ?? '')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('не подменяет отказ источника пустой таблицей', async () => {
    const user = userEvent.setup()
    const loadMarkets = vi
      .fn<MarketPricesLoader>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([BITCOIN])

    renderCard(loadMarkets)

    expect(await screen.findByText('Prices are unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Bitcoin')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Bitcoin')).toBeInTheDocument()
  })
})
