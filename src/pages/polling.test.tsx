import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

/** Background balance-poll interval set by `BalanceService`. */
const POLL_INTERVAL_MS = 30_000

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    services.clock.advance(ms)
    await Promise.resolve()
  })
}

/**
 * Toggles tab visibility.
 *
 * `document.visibilityState` is read-only, so the property is
 * replaced. The event is dispatched by hand: jsdom does not fire it.
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

describe('Background balance polling', () => {
  it('runs while the tab is visible', async () => {
    renderApp()
    await screen.findByText('Account 1')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance).not.toBeNull()
    })

    const before = services.session.getSnapshot().balance?.updatedAt ?? 0

    await advance(POLL_INTERVAL_MS + 1_000)

    await waitFor(() => {
      expect(services.session.getSnapshot().balance?.updatedAt).toBeGreaterThan(before)
    })
  })

  it('stops when the tab is hidden', async () => {
    /* Polling a hidden tab wastes node limits and also keeps telling
       its operator that a wallet at this address is open while the
       user is busy elsewhere. */
    renderApp()
    await screen.findByText('Account 1')

    await waitFor(() => {
      expect(services.session.getSnapshot().balance).not.toBeNull()
    })

    await setVisibility('hidden')

    const before = services.session.getSnapshot().balance?.updatedAt ?? 0

    await advance(POLL_INTERVAL_MS * 3)

    expect(services.session.getSnapshot().balance?.updatedAt).toBe(before)
  })

  it('returning to the tab refreshes the value immediately', async () => {
    /* The shown balance is stale by the time the user returns, so
       waiting another poll interval is pointless. */
    renderApp()
    await screen.findByText('Account 1')

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
