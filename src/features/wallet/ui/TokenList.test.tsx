import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  TOKEN_STANDARD,
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

function renderList(
  portfolio: IPortfolioSummary | null,
  tokens: readonly ITokenBalance[] = BALANCES,
  onRemove: ((address: Address) => void) | null = () => undefined,
) {
  return render(
    <TokenList
      tokens={tokens}
      isLoading={false}
      portfolio={portfolio}
      {...(onRemove === null ? {} : { onRemove })}
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

  it('оценивает каждую строку по своей сети, а не по одной общей', () => {
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

  it('показывает нативную валюту двух сетей двумя строками', () => {
    const optimismEth: IToken = { ...ETH, chainId: toChainId(10n), name: 'Ether on Optimism' }

    renderList(null, [
      { token: ETH, balance: 1n * ETHER },
      { token: optimismEth, balance: 2n * ETHER },
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('без обработчика удаления не показывает кнопку', () => {
    renderList(null, BALANCES, null)

    expect(screen.queryByRole('button', { name: /Remove token/i })).not.toBeInTheDocument()
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
