import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EncryptionService, type Wei } from '@/core'
import { APP_CONFIG, TEST_MODE } from '@/shared/config'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'
import { readLoginCredentials, writeLoginCredentials } from '@/features/onboarding'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const USERNAME = 'james@example.com'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

let services: ITestAppServices
let service: ITestAppServices['onboarding']

/**
 * Renders the app against a real core.
 *
 * Encryption is swapped for a fast stand-in: production PBKDF2 (600 000
 * iterations) would add half a second to every test. Network nodes are
 * stubbed so the suite does not wait on public RPC. Everything else —
 * BIP-39, BIP-32, AES-GCM, storage — runs for real.
 */
function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

beforeEach(() => {
  window.location.hash = ''
  localStorage.clear()
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })
  service = services.onboarding
})

describe('Welcome screen', () => {
  it('offers wallet creation', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
  })

  it('shows seed-phrase import according to the mode', async () => {
    renderApp()

    await screen.findByRole('link', { name: /create a new wallet/i })

    /* The temporary relaxation hides seed-phrase import entirely.
       Follow the flag instead of pinning one of the two states:
       restoring the protection would otherwise fail the suite. */
    const importLink = screen.queryByRole('link', { name: /import/i })

    expect(importLink === null).toBe(TEST_MODE.hideSeedImport)
  })

  it('warns that recovery is impossible', async () => {
    renderApp()

    await screen.findByRole('link', { name: /create a new wallet/i })

    /* Assert the meaning, not the wording. With seed import hidden the
       warning must be even more definite: there is nothing to restore with. */
    expect(
      screen.getByText(
        TEST_MODE.hideSeedImport
          ? /no way to restore the wallet/i
          : /is an attempt to steal your funds/i,
      ),
    ).toBeInTheDocument()
  })

  it('does not mark empty fields as invalid on open', async () => {
    renderApp()

    const unlock = await screen.findByRole('button', { name: 'Unlock' })

    expect(unlock).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Directory account sign-in', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('opens the cabinet after a successful POST /v1/users/auth', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: '7',
            email: 'james@example.com',
            balance: '12.5',
            createdAt: '2026-08-19T12:00:00.000Z',
          }),
        ),
    }) as typeof fetch

    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Email'), 'james@example.com')
    await user.type(screen.getByLabelText('Password'), 'demo')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('heading', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.queryByText('12.5')).not.toBeInTheDocument()
    expect(screen.queryByText('ETH')).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Display currency' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Wallet sections' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Receive/i })).toBeEnabled()
    expect(screen.getAllByRole('link', { name: 'ET WALLET' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('james@example.com · Since Aug 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.some(
            ([url, init]) =>
              (typeof url === 'string' ? url : '').endsWith('/v1/users/auth') &&
              init?.method === 'POST',
          ),
      ).toBe(true)
    })

    const authCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(
        ([url, init]) =>
          (typeof url === 'string' ? url : '').endsWith('/v1/users/auth') &&
          init?.method === 'POST',
      )

    expect(JSON.parse(String(authCall?.[1]?.body))).toEqual({
      email: 'james@example.com',
      the_p: 'demo',
    })

    expect(readLoginCredentials()).toEqual({
      id: '7',
      email: 'james@example.com',
      theP: 'demo',
    })
    expect(readLoginCredentials()).not.toHaveProperty('balance')
  })

  it('does not open the cabinet on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { code: 'unauthorized' } })),
    }) as typeof fetch

    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Email'), 'james@example.com')
    await user.type(screen.getByLabelText('Password'), 'demo')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not unlock/i)
    expect(screen.queryByRole('navigation', { name: 'Wallet sections' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
    expect(readLoginCredentials()).toBeNull()
  })

  it('shows an error when the email is malformed', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByLabelText('Email'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'demo')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a valid email/i)
    expect(
      fetchMock.mock.calls.filter((call) => {
        const url = String(call[0] instanceof Request ? call[0].url : call[0])
        return (
          !url.includes('api.coingecko.com') &&
          !url.includes('api.coinbase.com') &&
          !url.includes('frankfurter.app') &&
          !url.includes('frankfurter.dev')
        )
      }),
    ).toHaveLength(0)
  })

  it('signs in automatically when credentials are stored', async () => {
    writeLoginCredentials({ id: '7', email: 'james@example.com', theP: '123456' })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: '7',
            email: 'james@example.com',
            balance: '3',
            createdAt: '2026-08-19T12:00:00.000Z',
          }),
        ),
    }) as typeof fetch

    renderApp()

    expect(await screen.findByRole('heading', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.getByText('$3.00')).toBeInTheDocument()
    expect(screen.queryByText('james@example.com · Since Aug 2026')).not.toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
    expect(readLoginCredentials()).toEqual({
      id: '7',
      email: 'james@example.com',
      theP: '123456',
    })
  })

  it('clears stored credentials when sign-in is rejected', async () => {
    writeLoginCredentials({ id: '7', email: 'james@example.com', theP: 'wrong' })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { code: 'unauthorized' } })),
    }) as typeof fetch

    renderApp()

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
    expect(readLoginCredentials()).toBeNull()
  })

  it('the lock button clears etwallet.login-credentials', async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
    writeLoginCredentials({ id: '7', email: USERNAME, theP: PASSWORD })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: '7',
            email: USERNAME,
            balance: '0',
            createdAt: '2026-08-19T12:00:00.000Z',
          }),
        ),
    }) as typeof fetch

    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Lock the wallet' }))

    expect(readLoginCredentials()).toBeNull()
  })
})

async function fillCreationForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))
  await user.type(await screen.findByLabelText(/Email/i), USERNAME)
  await user.type(screen.getByLabelText('Password'), PASSWORD)
  await user.type(screen.getByLabelText('Repeat the password'), PASSWORD)
}

describe('Wallet creation', () => {
  it('allows a simple password through', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))
    await user.type(await screen.findByLabelText(/Email/i), USERNAME)
    await user.type(screen.getByLabelText('Password'), '123456')
    await user.type(screen.getByLabelText('Repeat the password'), '123456')

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('blocks when the passwords do not match', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat the password'), 'Korova-7-Luna?')

    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('blocks without an email', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat the password'), PASSWORD)

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('blocks an invalid email', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))
    await user.type(await screen.findByLabelText(/Email/i), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat the password'), PASSWORD)

    expect(screen.getByText('Enter a valid email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('heading', { name: 'Create a wallet' })).toBeInTheDocument()
    expect(screen.getAllByText('Enter a valid email').length).toBeGreaterThan(0)
  })

  it('asks for email, not a name', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /create a new wallet/i }))

    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Your name/i)).not.toBeInTheDocument()
    expect(screen.getByText(/sign in with this email/i)).toBeInTheDocument()
  })

  it('shows the phrase only after an explicit action', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* The words are in the markup but hidden until click, so a glance
       over the shoulder does not reveal the phrase. */
    expect(screen.getByRole('button', { name: /Show the phrase/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Show the phrase/i }))

    expect(screen.getByRole('button', { name: /Hide/i })).toBeInTheDocument()
  })

  it('requires acknowledgement that the phrase was written down', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* The button label depends on the mode: with confirmation off it
       creates the wallet at once; with it on it leads to the word quiz.
       The write-down acknowledgement is required in both cases. */
    /* Both labels come from the dictionary. This branch used to keep a
       stale Russian button name because it never ran. */
    const submitName = APP_CONFIG.requiresSeedConfirmation ? 'Next' : 'Create wallet'

    expect(screen.getByRole('button', { name: submitName })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))

    expect(screen.getByRole('button', { name: submitName })).toBeEnabled()
  })

  it('warns that losing the phrase is irreversible', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText(/do not save the phrase in notes/i)).toBeInTheDocument()
  })

  it('still shows the phrase when confirmation is disabled', async () => {
    /* The relaxation drops the word quiz, not the phrase itself:
       the owner must still be able to write it down. */
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('button', { name: /Show the phrase/i })).toBeInTheDocument()
  })

  it('does not announce that confirmation is disabled', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    /* There is no separate warning that confirmation is off: it is off
       permanently, and announcing that on every creation is noise. */
    const notice = screen.queryByText(/confirmation .* disabled/i)

    expect(notice).toBeNull()
  })

  it('creates a wallet and labels it with the email', async () => {
    const user = userEvent.setup()
    renderApp()

    await fillCreationForm(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('checkbox'))

    if (APP_CONFIG.requiresSeedConfirmation) {
      /* The full word-quiz path is covered by a separate suite.
         Here only the account label after creation matters. */
      return
    }

    await user.click(screen.getByRole('button', { name: 'Create wallet' }))

    /* The header shows the owner's email, not a generic "Account 1". */
    expect(await screen.findByText(USERNAME)).toBeInTheDocument()
  })
})

/*
  The import screen is temporarily hidden by the relaxation flag.
  The suite follows the flag instead of being deleted: restoring the
  protection brings these checks back without reconstructing them.
*/
describe.skipIf(TEST_MODE.hideSeedImport)('Wallet import', () => {
  it('reports an invalid word count', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(await screen.findByLabelText('Seed phrase'), 'abandon abandon about')

    expect(await screen.findByText(/Allowed word counts: 12, 15, 18, 21, 24/i)).toBeInTheDocument()
  })

  it('points to words that are not in the dictionary', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(screen.getByLabelText('Seed phrase'), TEST_MNEMONIC.replace('about', 'xyzzy'))

    expect(await screen.findByText(/check the words at positions: 12/i)).toBeInTheDocument()
  })

  it('confirms a valid phrase', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(await screen.findByLabelText('Seed phrase'), TEST_MNEMONIC)

    expect(await screen.findByText('The phrase is valid')).toBeInTheDocument()
  })

  it('warns about phishing', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))

    expect(await screen.findByText(/has the right to\s+ask for it/i)).toBeInTheDocument()
  })

  it('warns about a well-known test phrase', async () => {
    /* Anyone who took the phrase from an article or example must learn
       that before sending funds to its address: anyone can compute
       its private keys. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(await screen.findByLabelText('Seed phrase'), TEST_MNEMONIC)

    expect(await screen.findByText(/well-known test phrase/i)).toBeInTheDocument()
  })

  it('the warning does not block import', async () => {
    /* Importing a test phrase is ordinary developer work. A ban instead
       of a warning would decide for the owner. */
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(await screen.findByLabelText('Seed phrase'), TEST_MNEMONIC)
    await user.type(screen.getByLabelText(/Email/i), USERNAME)
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat the password'), PASSWORD)

    expect(await screen.findByText(/well-known test phrase/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it('imports a wallet and leaves it unlocked', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /import/i }))
    await user.type(await screen.findByLabelText('Seed phrase'), TEST_MNEMONIC)
    await user.type(screen.getByLabelText(/Email/i), USERNAME)
    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat the password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Import' }))

    /* Unlock is confirmed by the wallet chrome showing the account
       derived from the seed phrase. */
    expect(await screen.findByText(USERNAME)).toBeInTheDocument()
  })
})

describe('Hidden seed-phrase import', () => {
  it('the import route is closed together with the button', async () => {
    /* Hiding the button while leaving the route open would still let
       anyone reach import by typing the URL. */
    openPath('/import')

    renderApp()

    if (TEST_MODE.hideSeedImport) {
      expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
      expect(screen.queryByLabelText('Seed phrase')).not.toBeInTheDocument()
    } else {
      expect(await screen.findByLabelText('Seed phrase')).toBeInTheDocument()
    }
  })
})

describe('Unlock', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
    service.lock()
  })

  async function signIn(user: ReturnType<typeof userEvent.setup>, password: string): Promise<void> {
    await user.type(await screen.findByLabelText('Email'), USERNAME)
    await user.type(await screen.findByLabelText('Password'), password)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
  }

  it('opens with the correct password', async () => {
    const user = userEvent.setup()
    renderApp()

    await signIn(user, PASSWORD)

    /* Unlock is confirmed by the wallet chrome labeled with the owner. */
    expect(await screen.findByText(USERNAME)).toBeInTheDocument()
  })

  it('sign-in requires email and password', async () => {
    renderApp()

    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Name$/i)).not.toBeInTheDocument()
  })

  it('reports an error on a wrong password', async () => {
    const user = userEvent.setup()
    renderApp()

    await signIn(user, 'Nepravilnyy-1!')

    expect(await screen.findByRole('alert')).toHaveTextContent(/wrong password/i)
  })

  it('does not reveal what failed', async () => {
    /* Distinguishing "wrong password" from "storage is corrupted" helps
       an attacker, not the owner. */
    const user = userEvent.setup()
    renderApp()

    await signIn(user, 'Nepravilnyy-1!')

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).not.toMatch(/corrupted|checksum|tag/i)
  })

  it('leads to the reset page', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: /forgot your password/i }))

    expect(await screen.findByText('Erase the wallet from this device')).toBeInTheDocument()
  })
})

describe('Forgot password', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD)
    service.lock()
    openPath('/forgot-password')
  })

  it('says immediately that recovery is impossible', async () => {
    renderApp()

    expect(await screen.findByText(/It cannot be\s+restored/i)).toBeInTheDocument()

    expect(await screen.findByText('Erase the wallet from this device')).toBeInTheDocument()
  })

  it('warns that funds would be lost for good', async () => {
    renderApp()

    expect(await screen.findByText(/the\s+funds will be lost/i)).toBeInTheDocument()
  })

  it('requires two confirmations', async () => {
    const user = userEvent.setup()
    renderApp()

    const resetButton = await screen.findByRole('button', { name: 'Erase the wallet' })

    expect(resetButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))

    /* The checkbox stops an accidental click; typing the word stops
       ticking boxes without reading. */
    expect(resetButton).toBeDisabled()

    await user.type(screen.getByLabelText(/Type the word/i), 'ERASE')

    expect(resetButton).toBeEnabled()
  })

  it('does not allow typing the word before the phrase acknowledgement', async () => {
    renderApp()

    expect(await screen.findByLabelText(/Type the word/i)).toBeDisabled()
  })

  it('erases the wallet and returns to the welcome screen', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('checkbox'))
    await user.type(screen.getByLabelText(/Type the word/i), 'ERASE')
    await user.click(screen.getByRole('button', { name: 'Erase the wallet' }))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
    })
  })
})

describe('Routing by wallet state', () => {
  it('shows the welcome screen when no wallet exists', async () => {
    renderApp()

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()
  })

  it('redirects a created wallet to unlock', async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD)
    service.lock()

    renderApp()

    /* A locked wallet must not show the creation screen: the user would
       create a second wallet on top of the first. */
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })
})

describe('Production encryption parameters', () => {
  it('default encryption stays at production strength', () => {
    /* Fast encryption exists only in tests. This pins that the weaker
       KDF did not leak into the defaults used by the composition root. */
    expect(new EncryptionService().createKdfParams().iterations).toBe(600_000)
  })
})

describe('Path to another wallet', () => {
  beforeEach(async () => {
    await service.importWallet(TEST_MNEMONIC, PASSWORD, USERNAME)
    service.lock()
  })

  it('the sign-in screen offers creating another wallet', async () => {
    /* Someone who remembers the password but wants another wallet will
       not click "forgot password" — and will think the wallet leads
       nowhere. */
    renderApp()

    expect(
      await screen.findByRole('link', {
        name: /create another wallet|restore from a seed phrase/i,
      }),
    ).toBeInTheDocument()
  })

  it('leads to the erase screen, which explains both cases', async () => {
    const user = userEvent.setup()

    renderApp()
    await user.click(
      await screen.findByRole('link', {
        name: /create another wallet|restore from a seed phrase/i,
      }),
    )

    expect(await screen.findByText('A forgotten password.')).toBeInTheDocument()
    expect(screen.getByText(/Another wallet is needed/i)).toBeInTheDocument()
  })

  it('names the main constraint: one wallet per device', async () => {
    /* Otherwise it is unclear why a second wallet cannot just be created. */
    const user = userEvent.setup()

    renderApp()
    await user.click(
      await screen.findByRole('link', {
        name: /create another wallet|restore from a seed phrase/i,
      }),
    )

    expect(await screen.findByText(/A device\s+holds one wallet/i)).toBeInTheDocument()
  })
})
