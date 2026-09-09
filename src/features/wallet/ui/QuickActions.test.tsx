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

function renderActions(props: {
  readonly account?: IAccount | null
  readonly wallets?: Parameters<typeof QuickActions>[0]['wallets']
  readonly isGeneratingReceivingWallet?: boolean
  readonly onGenerateReceivingWallet?: () => void
  readonly isGeneratingExchangeWallet?: boolean
  readonly onGenerateExchangeWallet?: () => void
} = {}) {
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
    expect(screen.getAllByRole('button', { name: /generate wallet/iu })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /receive/iu })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows Generate wallet when address-receiving-funds is missing', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    renderActions({
      account: null,
      wallets: {},
      onGenerateReceivingWallet: generate,
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText('Address for receiving funds')).toBeInTheDocument()
    expect(screen.getAllByText('No wallet has been generated yet.').length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: /generate wallet/iu })[0] as HTMLElement)

    expect(generate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(ACCOUNT.address)).not.toBeInTheDocument()
  })

  it('always shows address-receiving-funds on Receive, even with no local account', async () => {
    const user = userEvent.setup()
    const stored = '0x21AA8fD5904abb079bc21e8454F71947288ce431'

    renderActions({
      account: null,
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key: stored, value: '0' },
      },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText('Address for receiving funds')).toBeInTheDocument()
    expect(screen.getByText(stored)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate wallet/iu })).toBeInTheDocument()
  })

  it('shows Generate wallet when the exchange field is missing', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    renderActions({
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key: RECEIVE_ADDRESS, value: '0' },
      },
      onGenerateExchangeWallet: generate,
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))
    await user.click(screen.getByRole('button', { name: /generate wallet/iu }))

    expect(screen.queryByText(EXCHANGE_ADDRESS)).not.toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('shows Generate wallet when the exchange field is not a valid address', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: {
        'address-receiving-funds-exchange': { key: 'not-an-address', value: '0' },
      },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getAllByRole('button', { name: /generate wallet/iu }).length).toBeGreaterThan(0)
    expect(screen.queryByText('not-an-address')).not.toBeInTheDocument()
  })

  it('ignores wallets that are not the codename map', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: [
        {
          key: EXCHANGE_ADDRESS,
          value: '0',
          codename: 'address-receiving-funds-exchange',
        },
      ] as never,
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getAllByRole('button', { name: /generate wallet/iu }).length).toBeGreaterThan(0)
    expect(screen.queryByText(EXCHANGE_ADDRESS)).not.toBeInTheDocument()
  })

  it('shows the exchange address only for a valid map slot', async () => {
    const user = userEvent.setup()

    renderActions({
      wallets: {
        [WALLET_CODENAME_RECEIVING_FUNDS]: { key: RECEIVE_ADDRESS, value: '0' },
        'address-receiving-funds-exchange': { key: EXCHANGE_ADDRESS, value: '0' },
      },
    })

    await user.click(screen.getByRole('button', { name: /receive/iu }))

    expect(screen.getByText(EXCHANGE_ADDRESS)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate wallet/iu })).not.toBeInTheDocument()
  })

  it('changes generate button text while generation is in progress', async () => {
    const user = userEvent.setup()
    const generate = vi.fn()

    renderActions({
      isGeneratingExchangeWallet: true,
      onGenerateExchangeWallet: generate,
    })

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
