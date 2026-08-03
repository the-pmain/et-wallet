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

    expect(await screen.findByText('The wallet is about to lock')).toBeInTheDocument()
  })

  it('блокирует кошелёк по истечении срока', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)

    /* Признак блокировки — экран ввода пароля. */
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })

  it('не блокирует раньше срока', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 120_000)

    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  })

  it('продление снимает предупреждение и откладывает блокировку', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)
    await user.click(await screen.findByRole('button', { name: /stay in the wallet/i }))

    expect(screen.queryByText('The wallet is about to lock')).not.toBeInTheDocument()

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  })

  it('объясняет, что средства не затронуты', async () => {
    /* Без объяснения внезапно закрывшийся кошелёк выглядит как потеря
       доступа к средствам. */
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(await screen.findByText(/your funds are not affected/i)).toBeInTheDocument()
  })

  it('после блокировки предупреждение не всплывает заново', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)
    await screen.findByText('Welcome back')

    expect(screen.queryByText('The wallet is about to lock')).not.toBeInTheDocument()
  })
})

describe('Settings безопасности', () => {
  it('позволяют выбрать срок автоблокировки', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    window.location.hash = '#/wallet/settings'

    await user.click(await screen.findByRole('button', { name: '5 min' }))

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

    await user.click(await screen.findByLabelText(/ask for the password before signing/i))

    await waitFor(async () => {
      expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(false)
    })
  })

  it('по умолчанию подтверждение включено', async () => {
    /* Защита, выключенная по умолчанию, защитой не является. */
    expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(true)
  })
})
