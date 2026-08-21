import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/app/providers/I18nProvider'

import { DISPLAY_CURRENCY } from '../lib/display-currency'
import { CurrencySwitch } from './CurrencySwitch'

describe('CurrencySwitch', () => {
  it('стоит группой радиокнопок и сообщает выбранную валюту', async () => {
    const user = userEvent.setup()
    const seen: string[] = []

    render(
      <I18nProvider>
        <CurrencySwitch
          value={DISPLAY_CURRENCY.Usd}
          onChange={(currency) => {
            seen.push(currency)
          }}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('radiogroup', { name: 'Display currency' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'USD' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'EUR' }))

    expect(seen).toEqual(['EUR'])
  })
})
