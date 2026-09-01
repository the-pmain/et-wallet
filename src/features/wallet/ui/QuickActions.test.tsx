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

describe('QuickActions: smart contract dialog', () => {
  it('до нажатия окна нет', () => {
    renderActions()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('нажатие открывает окно с сообщением о включённом режиме', async () => {
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Smart contract mode activated')).toBeInTheDocument()
    expect(screen.getByText('Contract module is active')).toBeInTheDocument()
  })

  it('окно связано с заголовком для программ чтения экрана', async () => {
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))

    const dialog = screen.getByRole('dialog')
    const labelId = dialog.getAttribute('aria-labelledby')

    expect(labelId).not.toBeNull()
    expect(document.getElementById(labelId as string)?.textContent).toBe(
      'Smart contract mode activated',
    )
  })

  it('закрывается кнопкой подтверждения', async () => {
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))
    await user.click(screen.getByRole('button', { name: 'Got it' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('закрывается крестиком и открывается снова', async () => {
    /* Закрытие обязано дойти до состояния снаружи: иначе окно, убранное
       крестиком, осталось бы «открытым» в состоянии, и повторное
       нажатие кнопки не показало бы ничего. */
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('закрывается клавишей Escape', async () => {
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
