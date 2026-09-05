import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { toAddress, type IAccount } from '@/core'
import { I18nProvider } from '@/app/providers/I18nProvider'

import { QuickActions } from './QuickActions'

const ACCOUNT = {
  id: 'account-1',
  name: 'Main',
  address: toAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  index: 0,
  isHidden: false,
} as unknown as IAccount

function renderActions() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <QuickActions account={ACCOUNT} />
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('QuickActions: exchange receive address', () => {
  it('hides the exchange section until Receive is pressed', async () => {
    const user = userEvent.setup()

    renderActions()

    expect(
      screen.queryByText('Address for receiving funds from exchange or institution'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(
      screen.getByText('Address for receiving funds from exchange or institution'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /copy/iu }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /generate a wallet/iu })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /receive/iu })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changes generate button text while generation is in progress', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    render(
      <MemoryRouter>
        <I18nProvider>
          <QuickActions
            account={ACCOUNT}
            isGeneratingExchangeWallet={true}
            onGenerateExchangeWallet={generate}
          />
        </I18nProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByRole('button', { name: /wallet generation request sent/iu })).toBeDisabled()
  })
})

describe('QuickActions: smart contract', () => {
  it('keeps the smart-contract tile in place and disabled until the feature exists', () => {
    renderActions()

    expect(screen.getByRole('button', { name: /smart contract/iu })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
