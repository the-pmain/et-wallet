import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/app/providers/I18nProvider'

import { DisplayCurrencyProvider } from '../model/display-currency-context'
import { FiatBalanceCard } from './FiatBalanceCard'

const RATES = { USD: 1, EUR: 0.8, GBP: 0.5 } as const

function renderCard(amountUsd: number | null) {
  return render(
    <I18nProvider>
      <DisplayCurrencyProvider>
        <FiatBalanceCard amountUsd={amountUsd} rates={RATES} />
      </DisplayCurrencyProvider>
    </I18nProvider>,
  )
}

describe('FiatBalanceCard', () => {
  it('shows dollars as a large figure, not a raw string and not ETH', () => {
    renderCard(350)

    expect(screen.getByText('$350.00')).toBeInTheDocument()
    expect(screen.queryByText('350')).not.toBeInTheDocument()
    expect(screen.queryByText('ETH')).not.toBeInTheDocument()
    expect(screen.queryByText(/buy ethereum/iu)).not.toBeInTheDocument()
  })

  it('renders a zero balance as money, not as 0 ETH', () => {
    renderCard(0)

    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.queryByText('0 ETH')).not.toBeInTheDocument()
    expect(screen.queryByText(/^0$/u)).not.toBeInTheDocument()
  })

  it('holds the amount-row height while the spinner runs', () => {
    render(
      <I18nProvider>
        <DisplayCurrencyProvider>
          <FiatBalanceCard amountUsd={null} isRefreshing rates={RATES} />
        </DisplayCurrencyProvider>
      </I18nProvider>,
    )

    expect(screen.getByText('Estimating the value…')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.getByText('Estimating the value…').parentElement).toHaveClass(
      'min-h-10',
      'sm:min-h-12',
    )
  })

  it('switches the display to euros and pounds without changing the money', async () => {
    const user = userEvent.setup()

    renderCard(100)

    await user.click(screen.getByRole('radio', { name: 'EUR' }))
    expect(screen.getByText('€80.00')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'GBP' }))
    expect(screen.getByText('£50.00')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'USD' }))
    expect(screen.getByText('$100.00')).toBeInTheDocument()
  })
})
