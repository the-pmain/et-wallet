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

/** Целые эфиры: `balanceOf(2n)` — два эфира, а не два вея. */
const ETHER = 10n ** 18n

function balanceOf(raw: bigint): IBalance {
  return {
    raw: toWei(raw * ETHER),
    decimals: 18,
    chainId: CHAIN_ID,
    isStale: false,
  } as unknown as IBalance
}

/** Сводка с известным курсом эфира. */
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

/** Узел с самой суммой: он идёт первым и несёт крупный кегль. */
function amountNode(): HTMLElement {
  return document.querySelector('[data-slot=card-content] p.text-4xl') as HTMLElement
}

/**
 * Движение суммы означает ПРИХОД ДРУГОГО ЗНАЧЕНИЯ.
 *
 * Проверяется тестом, а не глазами: браузерная панель предпросмотра
 * в этой среде не рисует кадров, и анимация в ней всегда стоит на нуле.
 * Наличие или отсутствие классов появления — то, что можно утверждать
 * достоверно.
 */
describe('BalanceCard: появление суммы', () => {
  it('при первом показе не анимируется', () => {
    renderCard(balanceOf(5n))

    /* Экран в этот момент уже появляется целиком. Второй вход на самом
       крупном объекте поверх первого читается как рябь. */
    expect(amountNode().className).not.toContain('animate-in')
  })

  it('анимируется, когда пришло другое значение', () => {
    const view = renderCard(balanceOf(5n))

    view.rerender(card(balanceOf(7n)))

    expect(amountNode().className).toContain('animate-in')
  })

  it('не анимируется, когда сумма прежняя', () => {
    const view = renderCard(balanceOf(5n))

    /* Сессия пересоздаёт объект баланса при каждом обновлении.
       Сравнивается значение, а не ссылка, иначе рябь шла бы на каждый
       опрос узла. */
    view.rerender(card(balanceOf(5n)))

    expect(amountNode().className).not.toContain('animate-in')
  })

  it('помечает область занятой, пока сумма обновляется', () => {
    renderCard(balanceOf(5n), { isLoading: true })

    /* Вращение значка — единственный признак работы для зрячего;
       для слушающего страницу им служит эта пометка. */
    const content = document.querySelector('[data-slot=card-content]')

    expect(content?.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByLabelText('Refresh the balance')).toBeDisabled()
  })
})

describe('BalanceCard: оценка в долларах', () => {
  it('показывает оценку показанной суммы', () => {
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.getByText('approximately $6,000.00')).toBeInTheDocument()
  })

  it('оценивает свежую сумму, а не ту, по которой считалась сводка', () => {
    /* Кнопка обновления баланса портфель не пересчитывает. Готовое
       значение из сводки описывало бы прежнюю сумму — и стояло бы
       вплотную под новой. */
    renderCard(balanceOf(5n), {
      arePricesEnabled: true,
      portfolio: portfolioAt(3000, 2n),
    })

    expect(screen.getByText('approximately $15,000.00')).toBeInTheDocument()
  })

  it('без согласия предлагает переход, а не запрашивает курсы', () => {
    /* Обращение к источнику курсов выдаёт ему состав портфеля.
       Согласие берётся на экране портфеля, где перечислено, что именно
       уйдёт наружу; здесь — только переход туда. */
    renderCard(balanceOf(2n), { arePricesEnabled: false, portfolio: portfolioAt(3000) })

    expect(screen.getByRole('link', { name: /show the value in dollars/iu })).toHaveAttribute(
      'href',
      '/wallet/portfolio',
    )
    expect(screen.queryByText(/approximately/iu)).not.toBeInTheDocument()
  })

  it('не подставляет ноль, когда курс неизвестен', () => {
    /* Самая опасная подмена в этом месте: «0,00 $» под непустым
       балансом читается как «средства ничего не стоят». */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: null })

    expect(screen.getByText('The value could not be estimated')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00/u)).not.toBeInTheDocument()
  })

  it('пока курсы идут, не объявляет оценку недоступной', () => {
    renderCard(balanceOf(2n), {
      arePricesEnabled: true,
      portfolio: null,
      isPortfolioLoading: true,
    })

    expect(screen.getByText('Estimating the value…')).toBeInTheDocument()
    expect(screen.queryByText('The value could not be estimated')).not.toBeInTheDocument()
  })

  it('показывает время котировки рядом с оценкой', () => {
    /* Курс опрашивается раз в минуту, но при отказе источника на экране
       остаётся прежний. Живое число от замершего отличает только
       время. */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.getByText(/^Rate as of \d{1,2}:\d{2}/u)).toBeInTheDocument()
  })

  it('не выдумывает время, когда момент котировки неизвестен', () => {
    /* Подставить текущее время значило бы объявить свежим то,
       о чём ничего не известно. */
    renderCard(balanceOf(2n), { arePricesEnabled: true, portfolio: null })

    expect(screen.queryByText(/Rate as of/u)).not.toBeInTheDocument()
  })

  it('без баланса не занимает места', () => {
    renderCard(null, { arePricesEnabled: true, portfolio: portfolioAt(3000) })

    expect(screen.queryByText(/approximately/iu)).not.toBeInTheDocument()
    expect(screen.queryByText('The value could not be estimated')).not.toBeInTheDocument()
  })
})
