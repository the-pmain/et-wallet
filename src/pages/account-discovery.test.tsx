import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress, type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Третий адрес тестовой фразы: им «пользовались» до восстановления. */
const THIRD = toAddress(TEST_MNEMONIC_ADDRESSES[2] as string)

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.location.hash = ''
  services = createTestAppServices()
})

describe('Восстановление находит занятые адреса', () => {
  it('аккаунт с балансом появляется сам', async () => {
    /* САМЫЙ ОПАСНЫЙ ПЕРВЫЙ ЭКРАН. Адреса выводятся из фразы, но кошелёк
       о них не знает, пока не выведет: человек, у которого было три
       аккаунта, увидел бы один и разумно заключил, что средства
       пропали. */
    services.providerFactory.configure({
      balance: 0n as Wei,
      balancesByAddress: [{ address: THIRD, balance: BALANCE }],
    })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()

    await waitFor(
      () => {
        expect(services.session.getSnapshot().accounts.length).toBeGreaterThan(1)
      },
      { timeout: 10_000 },
    )

    const addresses = services.session
      .getSnapshot()
      .accounts.map((account) => account.address.toLowerCase())

    expect(addresses).toContain(THIRD.toLowerCase())
  })

  it('пустой кошелёк лишних аккаунтов не получает', async () => {
    /* Поиск ничего не нашёл — значит и добавлять нечего. Лишний
       аккаунт сбивал бы с толку не меньше пропавшего. */
    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    expect(services.session.getSnapshot().accounts).toHaveLength(1)
  })

  it('поиск повторяется по кнопке в настройках', async () => {
    /* Первый поиск мог пройти при недоступном узле. Кнопка — способ
       повторить, не пересоздавая кошелёк. */
    const user = userEvent.setup()

    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    services.providerFactory.configure({
      balance: 0n as Wei,
      balancesByAddress: [{ address: THIRD, balance: BALANCE }],
    })

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /Find my accounts/i }))

    expect(await screen.findByText(/Found and added 1 account/i)).toBeInTheDocument()
  })

  it('итог называет глубину поиска и его границы', async () => {
    /* «Ничего не найдено» без глубины читается как «у вас больше ничего
       нет» — утверждение, которого поиск не делает: адреса, где лежат
       только токены, он не видит. */
    const user = userEvent.setup()

    services.providerFactory.configure({ balance: 0n as Wei })

    await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)

    renderApp()
    await screen.findByText('Account 1')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /Find my accounts/i }))

    expect(await screen.findByText(/addresses were checked/i)).toBeInTheDocument()
    expect(screen.getByText(/only tokens or collectibles are not found/i)).toBeInTheDocument()
  })
})
