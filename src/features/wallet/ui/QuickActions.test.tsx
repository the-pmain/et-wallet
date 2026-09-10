import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { toAddress, type IAccount } from '@/core'
import { I18nProvider } from '@/app/providers/I18nProvider'
import { WALLET_CODENAME_RECEIVING_FUNDS } from '@/features/onboarding'

import { QuickActions } from './QuickActions'

const ACCOUNT = {
  id: 'account-1',
  name: 'Main',
  address: toAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  index: 0,
  isHidden: false,
} as unknown as IAccount

const EXCHANGE_ADDRESS = '0x15F3F1De82300D0DD5DCFF84Ee1341cEA3502f79'
const RECEIVE_ADDRESS = '0xfBb172681003704E0Be28D40f99d0934Ed365067'

function renderActions(
  props: {
    readonly account?: IAccount | null
    readonly wallets?: Parameters<typeof QuickActions>[0]['wallets']
    readonly isGeneratingReceivingWallet?: boolean
    readonly onGenerateReceivingWallet?: () => void
    readonly isGeneratingExchangeWallet?: boolean
    readonly onGenerateExchangeWallet?: () => void
  } = {},
) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <QuickActions
          account={props.account === undefined ? ACCOUNT : props.account}
          {...(props.wallets === undefined ? {} : { wallets: props.wallets })}
          {...(props.isGeneratingReceivingWallet === undefined
            ? {}
            : { isGeneratingReceivingWallet: props.isGeneratingReceivingWallet })}
          {...(props.onGenerateReceivingWallet === undefined
            ? {}
            : { onGenerateReceivingWallet: props.onGenerateReceivingWallet })}
          {...(props.isGeneratingExchangeWallet === undefined
            ? {}
            : { isGeneratingExchangeWallet: props.isGeneratingExchangeWallet })}
          {...(props.onGenerateExchangeWallet === undefined
            ? {}
            : { onGenerateExchangeWallet: props.onGenerateExchangeWallet })}
        />
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

    expect(screen.getByText('Address for receiving funds')).toBeInTheDocument()
    expect(
      screen.getByText('Address for receiving funds from exchange or institution'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /copy/iu }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: /generate a wallet/iu })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /receive/iu })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers Generate a wallet when address-receiving-funds is missing', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    renderActions({ account: null, wallets: {}, onGenerateReceivingWallet: generate })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText('Address for receiving funds')).toBeInTheDocument()
    expect(screen.getAllByText('No wallet has been generated yet.').length).toBeGreaterThan(0)

    await user.click(
      screen.getAllByRole('button', { name: /generate a wallet/iu })[0] as HTMLElement,
    )

    expect(generate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(ACCOUNT.address)).not.toBeInTheDocument()
  })

  it('shows the receiving address from the record without a local account', async () => {
    const user = userEvent.setup()

    renderActions({
      account: null,
      wallets: { [WALLET_CODENAME_RECEIVING_FUNDS]: { key: RECEIVE_ADDRESS, value: '0' } },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText(RECEIVE_ADDRESS)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate a wallet/iu })).toBeInTheDocument()
  })

  it('ignores a slot whose key is not an address', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: { 'address-receiving-funds-exchange': { key: 'not-an-address', value: '0' } },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getAllByRole('button', { name: /generate a wallet/iu })).toHaveLength(2)
    expect(screen.queryByText('not-an-address')).not.toBeInTheDocument()
  })

  it('reads address-receiving-funds-exchange from a wallets list', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: [
        { key: RECEIVE_ADDRESS, value: '0', codename: 'address-receiving-funds' },
        { key: EXCHANGE_ADDRESS, value: '0', codename: 'address-receiving-funds-exchange' },
      ] as never,
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText(EXCHANGE_ADDRESS)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate a wallet/iu })).not.toBeInTheDocument()
  })

  it('shows Generate a wallet when the list has no exchange field', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: [
        { key: RECEIVE_ADDRESS, value: '0', codename: 'address-receiving-funds' },
        { key: EXCHANGE_ADDRESS, value: '0', codename: 'wallet-other' },
      ] as never,
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByRole('button', { name: /generate a wallet/iu })).toBeInTheDocument()
    expect(screen.queryByText(EXCHANGE_ADDRESS)).not.toBeInTheDocument()
  })

  it('drops both buttons once the two slots are filled', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key: RECEIVE_ADDRESS, value: '0' },
        'address-receiving-funds-exchange': { key: EXCHANGE_ADDRESS, value: '0' },
      },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText(RECEIVE_ADDRESS)).toBeInTheDocument()
    expect(screen.getByText(EXCHANGE_ADDRESS)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate a wallet/iu })).not.toBeInTheDocument()
  })

  it('changes generate button text while generation is in progress', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    renderActions({ isGeneratingExchangeWallet: true, onGenerateExchangeWallet: generate })

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
