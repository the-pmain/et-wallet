import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'
/** Owner email: the sign-in identifier, stored in the `email` column. */
const USERNAME = 'owner@example.com'
const WRONG_PASSWORD = 'Sobaka-9-Solnce!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function openBackup(): Promise<void> {
  await screen.findByText(USERNAME)
  openPath('/wallet/backup')

  await screen.findByRole('heading', { name: 'Backup' })
}

async function reachPasswordStep(button: string, acknowledge: string): Promise<void> {
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: button }))
  await user.click(await screen.findByRole('checkbox'))
  await user.click(await screen.findByRole('button', { name: acknowledge }))
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
})

describe('Backup: screen', () => {
  it('explains what losing the phrase means', async () => {
    renderApp()
    await openBackup()

    expect(screen.getByText(/obtains the wallet/i)).toBeInTheDocument()
  })

  it('does not show secrets before they are requested', async () => {
    renderApp()
    await openBackup()

    expect(screen.queryByText('abandon')).not.toBeInTheDocument()
  })
})

describe('Backup: seed phrase', () => {
  it('requires a consequence acknowledgement before the password', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the seed phrase' }))

    expect(screen.getByText('The phrase opens the whole wallet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the phrase' })).toBeDisabled()
  })

  it('names that the device password does not protect the phrase', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the seed phrase' }))

    expect(screen.getByText(/The password of this device does not protect it/i)).toBeInTheDocument()
  })

  it('asks for the password even when the wallet is unlocked', async () => {
    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    expect(screen.getByText(/revealing the seed phrase/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('shows the phrase after the correct password', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('about')).toBeInTheDocument()
    expect(screen.getAllByText('abandon')).toHaveLength(11)
  })

  it('a wrong password does not reveal the phrase', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), WRONG_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(screen.queryByText('about')).not.toBeInTheDocument()
  })

  it('copying the phrase to the clipboard is not offered', async () => {
    /* Other apps can read the clipboard, and the phrase is the whole
       wallet. A copy button here would be convenience at the price of
       the one secret that cannot be changed. */
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('about')

    expect(screen.queryByRole('button', { name: /Copy/i })).not.toBeInTheDocument()
  })

  it('removes the phrase from the screen on close', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the seed phrase', 'Show the phrase')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await screen.findByText('about')
    await user.click(screen.getByRole('button', { name: 'Hide and close' }))

    expect(screen.queryByText('about')).not.toBeInTheDocument()
  })
})

describe('Backup: private key', () => {
  it('notes that a key cannot be revoked', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()

    await user.click(await screen.findByRole('button', { name: 'Show the private key' }))

    expect(screen.getByText('The key hands over the address for good')).toBeInTheDocument()
  })

  it('reveals the key after acknowledgement and password', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the private key', 'Show the key')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/^0x[0-9a-f]{64}$/i)).toBeInTheDocument()
  })

  it('the key is hidden until it is shown explicitly', async () => {
    const user = userEvent.setup()

    renderApp()
    await openBackup()
    await reachPasswordStep('Show the private key', 'Show the key')

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    /* The value is in the markup but hidden from on-screen reading
       and blurred: a glance or a screen share will not reveal it. */
    expect(await screen.findByText(/^0x[0-9a-f]{64}$/i)).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument()
  })
})

describe('Written-copy check', () => {
  async function check(phrase: string, password: string): Promise<void> {
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/The phrase from your paper/i), phrase)
    await user.type(screen.getByLabelText(/Wallet password/i), password)
    await user.click(screen.getByRole('button', { name: 'Check' }))
  }

  it('a matching copy is confirmed', async () => {
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, PASSWORD)

    expect(await screen.findByText('The copy matches')).toBeInTheDocument()
  })

  it('a one-word error is named as a mismatch', async () => {
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC.replace('about', 'above'), PASSWORD)

    expect(await screen.findByText('The copy does not match')).toBeInTheDocument()
  })

  it('the phrase is not shown after a mismatch', async () => {
    /* Showing the "correct" phrase after a failure would erase the
       point of the screen: it exists so the phrase is not revealed
       just to be checked. */
    renderApp()
    await openBackup()
    await check('abandon abandon abandon', PASSWORD)

    await screen.findByText('The copy does not match')

    expect(document.body.textContent).not.toContain(TEST_MNEMONIC)
  })

  it('does not say which word differs', async () => {
    /* A hint would help more than the owner: someone who found a
       paper with a few smudged words would guess the rest one by one. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC.replace('about', 'above'), PASSWORD)

    await screen.findByText('The copy does not match')

    expect(screen.getByText(/not shown on purpose/i)).toBeInTheDocument()
  })

  it('a wrong password is a refusal, not a mismatch', async () => {
    /* Otherwise the reply would say the password was guessed. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, WRONG_PASSWORD)

    expect(await screen.findByText(/password is wrong/i)).toBeInTheDocument()
    expect(screen.queryByText('The copy does not match')).not.toBeInTheDocument()
  })

  it('what was typed is cleared after the reply', async () => {
    /* A phrase left in the field is visible to anyone who walks
       up to the device. */
    renderApp()
    await openBackup()
    await check(TEST_MNEMONIC, PASSWORD)

    await screen.findByText('The copy matches')

    expect(screen.getByLabelText(/The phrase from your paper/i)).toHaveValue('')
    expect(screen.getByLabelText(/Wallet password/i)).toHaveValue('')
  })

  it('explains why the password is asked', async () => {
    /* On an unlocked wallet the demand looks like nitpicking unless
       it is said that it blocks someone else's guesses. */
    renderApp()
    await openBackup()

    expect(screen.getByText(/cannot be used to guess a phrase/i)).toBeInTheDocument()
  })
})
