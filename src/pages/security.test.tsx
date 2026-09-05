import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { DEFAULT_AUTO_LOCK_MS } from '@/features/security'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

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

describe('Auto-lock', () => {
  it('warns before locking', async () => {
    /* A lock mid-work loses what was typed; the warning lets the
       session be extended with one tap. */
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(await screen.findByText('The wallet is about to lock')).toBeInTheDocument()
  })

  it('locks the wallet when the interval expires', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)

    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })

  it('does not lock before the interval', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 120_000)

    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  })

  it('staying signed in dismisses the warning and postpones the lock', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)
    await user.click(await screen.findByRole('button', { name: /stay in the wallet/i }))

    expect(screen.queryByText('The wallet is about to lock')).not.toBeInTheDocument()

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
  })

  it('explains that funds are not affected', async () => {
    /* Without an explanation a wallet that closed suddenly looks like
       lost access to the funds. */
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS - 30_000)

    expect(await screen.findByText(/your funds are not affected/i)).toBeInTheDocument()
  })

  it('the warning does not pop up again after the lock', async () => {
    renderApp()
    await screen.findByText(EMAIL)

    await advance(DEFAULT_AUTO_LOCK_MS + 10_000)
    await screen.findByText('Welcome back')

    expect(screen.queryByText('The wallet is about to lock')).not.toBeInTheDocument()
  })
})

describe('Security settings', () => {
  it('let the user choose an auto-lock interval', async () => {
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    openPath('/wallet/settings')

    await user.click(await screen.findByRole('button', { name: '5 min' }))

    await waitFor(async () => {
      expect((await services.securitySettings.read()).autoLockTimeoutMs).toBe(5 * 60_000)
    })
  })

  it('let the user turn off sign confirmation', async () => {
    /* Turning it off is a deliberate owner choice, and it persists. */
    const user = userEvent.setup()

    renderApp()
    await screen.findByText(EMAIL)

    openPath('/wallet/settings')

    await user.click(await screen.findByLabelText(/ask for the password before signing/i))

    await waitFor(async () => {
      expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(false)
    })
  })

  it('confirmation is on by default', async () => {
    /* Protection that is off by default is not protection. */
    expect((await services.securitySettings.read()).confirmBeforeSigning).toBe(true)
  })
})
