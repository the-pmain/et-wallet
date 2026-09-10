import { expect, test, type Page } from '@playwright/test'

/**
 * Zero-entropy test mnemonic.
 *
 * Industry-standard vector. Funds on its addresses belong to nobody,
 * so it is fit for checks and unfit for anything else.
 */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const PASSWORD = 'Korova-7-Luna!'
const LOGIN_EMAIL = 'james@example.com'

/** First address of the test phrase at `m/44'/60'/0'/0/0`. */
const FIRST_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

/**
 * Restores a wallet from the test phrase.
 *
 * Storage is in memory, so each check starts clean and restores
 * the wallet again.
 */
async function importWallet(page: Page): Promise<void> {
  await page.goto('/import')

  await page.getByLabel('Seed phrase').fill(TEST_MNEMONIC)
  await page.getByLabel('Email').fill(LOGIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Repeat the password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Import' }).click()

  await expect(page.getByText(LOGIN_EMAIL)).toBeVisible()
}

async function unlockWallet(page: Page, password = PASSWORD): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(LOGIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Unlock' }).click()
}

test.describe('End-to-end: create and use a wallet', () => {
  test('the welcome screen opens from the built app', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })

  test('the wallet is restored from a seed phrase', async ({ page }) => {
    await importWallet(page)

    /* The address is derived by real BIP-32 in the built code: a
       match with the known value confirms derivation survived the
       build and unused-code stripping. */
    await expect(page.getByText('0x9858…aEda94')).toBeVisible()
  })

  test('wallet sections open: chunks load', async ({ page }) => {
    /* A screen whose chunk failed to load looks fine in jsdom
       checks: there `import()` resolves immediately. */
    await importWallet(page)

    for (const [path, heading] of [
      ['/wallet/activity', 'Activity'],
      ['/wallet/assets', 'Assets'],
      ['/wallet/portfolio', 'Portfolio'],
      ['/wallet/settings', 'Settings'],
      ['/wallet/nft', 'NFT'],
      ['/wallet/connections', 'Connections'],
      ['/wallet/backup', 'Backup'],
    ] as const) {
      await page.goto(path)

      /* Level-1 heading, not any heading: the connections screen
         has an "Active connections" card, and a loose search would
         find both. */
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }
  })

  test('a locked wallet does not show sections', async ({ page }) => {
    /* A direct URL while the wallet is locked must land on the
       password screen, not the content. */
    await importWallet(page)

    await page.goto('/wallet/settings')
    await page.getByRole('button', { name: 'Lock the wallet' }).click()

    await page.goto('/wallet/settings')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()
  })

  test('the wallet survives a page reload', async ({ page }) => {
    /*
      MAIN DURABLE-STORAGE CHECK. Before it existed the wallet
      vanished with the tab, so it could not be used with real
      funds.

      After reload the wallet must be LOCKED, not open: the session
      encryption key lives in memory and is not saved — otherwise a
      reload would skip the password.
    */
    await importWallet(page)

    await page.reload()

    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeHidden()
  })

  test('a failed login does not close the form or count attempts', async ({ page }) => {
    await importWallet(page)
    await page.reload()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await unlockWallet(page, 'Sobaka-9-Solnce!')
      await page.waitForTimeout(150)
    }

    await expect(page.getByText(/Attempts left before a delay/i)).toBeHidden()
    await expect(page.getByText(/Too many attempts/i)).toBeHidden()
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeEnabled()
  })

  test('after several failures the correct password opens the wallet', async ({ page }) => {
    await importWallet(page)
    await page.reload()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await unlockWallet(page, 'Sobaka-9-Solnce!')
      await page.waitForTimeout(150)
    }

    await unlockWallet(page)

    await expect(page.getByText('0x9858…aEda94')).toBeVisible()
  })

  test('after reload the wallet opens with the same password', async ({ page }) => {
    await importWallet(page)
    await page.reload()

    await unlockWallet(page)

    /* Same address as before reload: the same phrase was decrypted. */
    await expect(page.getByText('0x9858…aEda94')).toBeVisible()
  })
})

test.describe('End-to-end: send', () => {
  test('the form does not continue with an unfit recipient', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/send')

    await page.getByLabel(/Recipient address/).fill('0x123')
    await page.getByLabel(/Amount/).fill('1')

    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  test('a recipient with a valid address is accepted', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/send')

    await page.getByLabel(/Recipient address/).fill(FIRST_ADDRESS)
    await page.getByLabel(/Amount/).fill('0.0001')

    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  test('asset picker offers the native currency', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/send')

    /* The asset list is built from tracked tokens, and native
       currency is always in it: it cannot be removed. An empty list
       would mean there is nothing to send at all. */
    await expect(page.getByLabel('What to send')).toHaveValue('native')
  })
})

test.describe('End-to-end: backup', () => {
  test('the seed phrase is not shown without a password and a check', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()

    await expect(page.getByRole('button', { name: 'Show the phrase' })).toBeDisabled()
    await expect(page.getByText('about')).toBeHidden()
  })

  /* The field is pinned by exact match: the backup screen has a
     second password field — for the written check — and a substring
     matches both. */
  test('the phrase is shown after a check and the correct password', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Show the phrase' }).click()

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page.getByText('about')).toBeVisible()
  })

  test('a wrong password does not reveal the phrase', async ({ page }) => {
    await importWallet(page)
    await page.goto('/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Show the phrase' }).click()

    await page.getByLabel('Password', { exact: true }).fill('Sobaka-9-Solnce!')
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page.getByText('Wrong password.')).toBeVisible()
    await expect(page.getByText('about')).toBeHidden()
  })
})
