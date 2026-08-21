import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/app/providers/I18nProvider'

import { FiatBalanceCard } from './FiatBalanceCard'

const RATES = { USD: 1, EUR: 0.8, GBP: 0.5 } as const

function renderCard(amountUsd: number | null) {
  return render(
    <I18nProvider>
      <FiatBalanceCard amountUsd={amountUsd} rates={RATES} />
    </I18nProvider>,
  )
}

describe('FiatBalanceCard', () => {
  it('показывает доллары крупным числом, а не сырую строку и не ETH', () => {
    renderCard(350)

    expect(screen.getByText('$350.00')).toBeInTheDocument()
    expect(screen.queryByText('350')).not.toBeInTheDocument()
    expect(screen.queryByText('ETH')).not.toBeInTheDocument()
    expect(screen.queryByText(/buy ethereum/iu)).not.toBeInTheDocument()
  })

  it('нулевой баланс рисует как деньги, а не как 0 ETH', () => {
    renderCard(0)

    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.queryByText('0 ETH')).not.toBeInTheDocument()
    expect(screen.queryByText(/^0$/u)).not.toBeInTheDocument()
  })

  it('переключает показ в евро и фунты, не меняя сами деньги', async () => {
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
