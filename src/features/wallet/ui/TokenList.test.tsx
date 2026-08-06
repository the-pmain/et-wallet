import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  TOKEN_STANDARD,
  buildPortfolio,
  priceRefKey,
  toAddress,
  toChainId,
  type IPortfolioSummary,
  type IToken,
  type Timestamp,
} from '@/core'

import type { ITokenBalance } from '../model/contracts'
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

/** Сводка по заданным курсам. Токены без записи остаются без котировки. */
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

function renderList(portfolio: IPortfolioSummary | null, chainId = CHAIN_ID) {
  return render(
    <TokenList
      tokens={BALANCES}
      isLoading={false}
      chainId={chainId}
      portfolio={portfolio}
      onRemove={() => undefined}
    />,
  )
}

describe('TokenList: оценка в долларах', () => {
  it('показывает оценку каждой строки с известным курсом', () => {
    renderList(
      portfolioWith([
        [ETH, 3000],
        [USDC, 1],
      ]),
    )

    expect(screen.getByText('≈ $6,000.00')).toBeInTheDocument()
    expect(screen.getByText('≈ $50.00')).toBeInTheDocument()
  })

  it('строку без курса оставляет без оценки, а не с нулём', () => {
    /* «$0.00» под непустым балансом читается как «этот актив ничего
       не стоит», тогда как кошелёк просто не знает его курса. */
    renderList(portfolioWith([[ETH, 3000]]))

    expect(screen.getByText('≈ $6,000.00')).toBeInTheDocument()
    expect(screen.queryByText('≈ $0.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$50/u)).not.toBeInTheDocument()
  })

  it('без согласия на курсы оценки нет вовсе', () => {
    renderList(null)

    expect(screen.queryByText(/≈/u)).not.toBeInTheDocument()
  })

  it('не оценивает по курсам другой сети', () => {
    /* Промежуток при переключении сети: список уже от новой сети,
       сводка ещё от прежней. Без сверки два эфира были бы оценены
       по курсу BNB. */
    renderList(
      portfolioWith([
        [ETH, 3000],
        [USDC, 1],
      ]),
      OTHER_CHAIN_ID,
    )

    expect(screen.queryByText(/≈/u)).not.toBeInTheDocument()
  })

  it('количество остаётся главным числом строки', () => {
    /* Настоящая величина — та, что в монетах: она точна и она
       подписывается. Оценка не должна её вытеснять. */
    renderList(portfolioWith([[ETH, 3000]]))

    const amount = screen.getByText('2')
    const value = screen.getByText('≈ $6,000.00')

    expect(amount.className).toContain('font-semibold')
    expect(value.className).toContain('text-xs')
  })
})
