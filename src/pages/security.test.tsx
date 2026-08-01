import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { DEFAULT_AUTO_LOCK_MS } from '@/features/security'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'
const EMAIL = 'owner@example.com'

const BALANCE = 1_000_000_000_000_000_000n as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Двигает управляемые часы внутри акта React. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    services.clock.advance(ms)
    await Promise.resolve()
  })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, EMAIL)
})

describe('Автоблокировка', () => {
  it('предупреждает до блокировки', async () => {
    /* Блокировка посреди работы теряет введённое; предупреждение даёт
       продлить сессию одним нажатием. */
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(await screen.findByText('Кошелёк скоро заблокируется')).toBeInTheDocument()
  })

  it('блокирует кошелёк по истечении срока', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)

    /* Признак блокировки — экран ввода пароля. */
    expect(await screen.findByText('С возвращением')).toBeInTheDocument()
  })

  it('не блокирует раньше срока', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 120_000)

    expect(screen.queryByText('С возвращением')).not.toBeInTheDocument()
  })

  it('продление снимает предупреждение и откладывает блокировку', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)
    await user.click(await screen.findByRole('button', { name: /остаться в кошельке/i }))

    expect(screen.queryByText('Кошелёк скоро заблокируется')).not.toBeInTheDocument()

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(screen.queryByText('С возвращением')).not.toBeInTheDocument()
  })

  it('объясняет, что средства не затронуты', async () => {
    /* Без объяснения внезапно закрывшийся кошелёк выглядит как потеря
       доступа к средствам. */
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(await screen.findByText(/средства при этом не затрагиваются/i)).toBeInTheDocument()
  })

  it('после блокировки предупреждение не всплывает заново', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)
    await screen.findByText('С возвращением')

    expect(screen.queryByText('Кошелёк скоро заблокируется')).not.toBeInTheDocument()
  })
})

describe('Настройки безопасности', () => {
  it('позволяют выбрать срок автоблокировки', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    window.location.hash = '#/wallet/settings'

    await user.click(await screen.findByRole('button', { name: '5 мин' }))

    await waitFor(async () => {
      expect((await services.securitySettings.read()).autoLockTimeoutMs).toBe(5 * 60_000)
    })
  })

  it('позволяют отключить подтверждение подписи', async () => {
    /* Отключение — осознанный выбор владельца, и он сохраняется. */
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    window.location.hash = '#/wallet/settings'

    await user.click(await screen.findByLabelText(/спрашивать пароль перед подписью/i))

    await waitFor(async () => {
      expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(false)
    })
  })

  it('по умолчанию подтверждение включено', async () => {
    /* Защита, выключенная по умолчанию, защитой не является. */
    expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(true)
  })
})
