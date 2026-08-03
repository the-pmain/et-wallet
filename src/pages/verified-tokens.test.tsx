import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** USDC в Ethereum: адрес входит во встроенный список проверенных. */
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Адрес, которого в списке нет. */
const UNKNOWN = toAddress('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D')

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает раздел активов. */
async function openAssets(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Assets' }))
  await screen.findByRole('heading', { level: 1, name: 'Assets' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Пометка проверенного контракта', () => {
  it('токен из встроенного списка помечен проверенным', async () => {
    /* Символ задаёт автор контракта: выпустить «USDC» может кто угодно.
       Отличает подделку от оригинала только адрес, и сверять его глазами
       человек не станет. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(USDC)

    renderApp()
    await openAssets()

    expect(await within(screen.getByRole('list')).findByText('verified')).toBeInTheDocument()
  })

  it('незнакомый контракт помечен непроверенным', async () => {
    /* Это не обвинение в подделке: список заведомо неполон, и почти
       все законные токены в него не входят. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN)

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(await list.findByText('unverified')).toBeInTheDocument()
    expect(list.queryByText('verified')).not.toBeInTheDocument()
  })

  it('подделка под известный символ проверенной не становится', async () => {
    /* Тот же символ, другой адрес — ровно так выглядит подмена. */
    services.providerFactory.configure({
      balance: BALANCE,
      tokens: [{ address: UNKNOWN, symbol: 'USDC', name: 'USD Coin', decimals: 6, balance: 0n }],
    })

    await services.session.open()
    await services.session.addToken(UNKNOWN)

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(await list.findByText('USDC')).toBeInTheDocument()
    expect(list.getByText('unverified')).toBeInTheDocument()
  })

  it('нативная валюта пометки не получает', async () => {
    /* Она часть конфигурации сети: пометка на каждой строке перестаёт
       читаться. */
    services.providerFactory.configure({ balance: BALANCE })

    renderApp()
    await openAssets()

    const list = within(screen.getByRole('list'))

    expect(list.queryByText('verified')).not.toBeInTheDocument()
    expect(list.queryByText('unverified')).not.toBeInTheDocument()
  })
})
