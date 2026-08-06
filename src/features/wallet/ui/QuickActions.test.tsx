import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

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

describe('QuickActions: окно смарт-контракта', () => {
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

  it('окно прямо говорит, что ничего не подписано и не отправлено', async () => {
    /* ГЛАВНАЯ ПРОВЕРКА. Окно объявляет режим включённым, а вызывать
       контракты кошелёк пока не умеет. Без этой оговорки заглушка
       читается как сообщение об отправке — то есть кошелёк сообщал бы
       о событии, которого не было. */
    const user = userEvent.setup()

    renderActions()

    await user.click(screen.getByRole('button', { name: /smart contract/iu }))

    expect(screen.getByText(/nothing has been signed or sent/iu)).toBeInTheDocument()
    expect(screen.getByText(/not wired up yet/iu)).toBeInTheDocument()
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
