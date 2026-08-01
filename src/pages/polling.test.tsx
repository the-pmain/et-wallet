import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Период фонового опроса баланса, заданный `BalanceService`. */
const POLL_INTERVAL_MS = 30_000

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

/**
 * Переключает состояние видимости вкладки.
 *
 * `document.visibilityState` доступно только для чтения, поэтому
 * подменяется свойство. Событие посылается вручную: jsdom сам его
 * не порождает.
 */
async function setVisibility(state: DocumentVisibilityState): Promise<void> {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })

  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
  await setVisibility('visible')
})

describe('Фоновый опрос баланса', () => {
  it('идёт, пока вкладка на виду', async () => {
    renderApp()
    await screen.findByText('Аккаунт 1')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance).not.toBeNull()
    })

    const before = services.session.getSnapshot().balance?.updatedAt ?? 0

    await advance(POLL_INTERVAL_MS + 1_000)

    await waitFor(() => {
      expect(services.session.getSnapshot().balance?.updatedAt).toBeGreaterThan(before)
    })
  })

  it('останавливается, когда вкладка ушла из виду', async () => {
    /* Опрос скрытой вкладки не только тратит лимиты узла: он продолжает
       сообщать его оператору, что кошелёк с этим адресом открыт, пока
       пользователь занят другим. */
    renderApp()
    await screen.findByText('Аккаунт 1')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance).not.toBeNull()
    })

    await setVisibility('hidden')

    const before = services.session.getSnapshot().balance?.updatedAt ?? 0

    await advance(POLL_INTERVAL_MS * 3)

    expect(services.session.getSnapshot().balance?.updatedAt).toBe(before)
  })

  it('возврат на вкладку обновляет значение сразу', async () => {
    /* Показанный баланс к моменту возврата заведомо устарел, и ждать
       ещё период опроса незачем. */
    renderApp()
    await screen.findByText('Аккаунт 1')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance).not.toBeNull()
    })

    await setVisibility('hidden')
    await advance(POLL_INTERVAL_MS * 2)

    const before = services.session.getSnapshot().balance?.updatedAt ?? 0

    await setVisibility('visible')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance?.updatedAt).toBeGreaterThan(before)
    })
  })
})
