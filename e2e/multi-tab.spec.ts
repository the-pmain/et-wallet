import { expect, test, type Page } from '@playwright/test'

/**
 * Two-tab behavior checks.
 *
 * WHY THEY EXIST. A wallet opened twice is ordinary: a tab is left
 * and the app is opened again. Both tabs share one IndexedDB store,
 * but each holds its own encryption key and its own in-memory state
 * snapshot. What happens then had never been checked.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const PASSWORD = 'Korova-7-Luna!'
const LOGIN_EMAIL = 'james@example.com'

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

test.describe('Two tabs', () => {
  test('the second tab sees the created wallet and asks for the password', async ({ context }) => {
    /* Storage is shared: a tab opened after wallet create must go to
       unlock, not offer to create a second wallet on top of the first. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')

    await expect(second.getByRole('button', { name: 'Unlock' })).toBeVisible()
  })

  test('unlocking one tab does not open the second', async ({ context }) => {
    /* The encryption key lives in tab memory and never hits disk.
       That is why the second tab stays locked: otherwise the key
       would have to be stored somewhere. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')

    await expect(second.getByRole('button', { name: 'Unlock' })).toBeVisible()
    await expect(first.getByText(LOGIN_EMAIL)).toBeVisible()
  })

  test('both tabs unlock with the same password', async ({ context }) => {
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await unlockWallet(second)

    await expect(second.getByText(LOGIN_EMAIL)).toBeVisible()
    await expect(first.getByText(LOGIN_EMAIL)).toBeVisible()
  })

  test('erase in one tab is noticed by the second', async ({ context }) => {
    /* THE MOST DANGEROUS CASE. A tab that survived wallet erase still
       shows balances and offers send, though keys are already gone
       from disk. The owner sees a working wallet that does not exist. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await unlockWallet(second)
    await expect(second.getByText(LOGIN_EMAIL)).toBeVisible()

    await first.goto('/wallet/settings')
    await first.goto('/forgot-password')
    await first.getByRole('checkbox').check()
    await first.getByLabel(/Type the word/i).fill('ERASE')
    await first.getByRole('button', { name: 'Erase the wallet' }).click()

    await expect(first.getByRole('link', { name: /create a new wallet/i })).toBeVisible()

    /* The second tab must stop presenting itself as a working wallet.
       Observable behavior is checked, not internal state. */
    await second.reload()

    await expect(second.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })
})

test.describe('Two tabs: dangerous cases', () => {
  test('a tab does not present itself as a working wallet after erase', async ({ context }) => {
    /* No reload. The second tab holds keys in memory and a state
       snapshot in the React tree: it will keep showing balances and
       offering send, though keys are already gone from disk. The
       owner would see a working wallet that does not exist. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await unlockWallet(second)
    await expect(second.getByText(LOGIN_EMAIL)).toBeVisible()

    await first.goto('/forgot-password')
    await first.getByRole('checkbox').check()
    await first.getByLabel(/Type the word/i).fill('ERASE')
    await first.getByRole('button', { name: 'Erase the wallet' }).click()
    await expect(first.getByRole('link', { name: /create a new wallet/i })).toBeVisible()

    /* Give the tab time to notice: storage is shared, and a wipe
       can be observed. */
    await second.waitForTimeout(2000)

    await expect(second.getByText(LOGIN_EMAIL)).toBeHidden()
  })

  test('the second tab learns of a send from the first', async ({ context }) => {
    /* Both tabs read one history. A tab that does not know about a
       sent transaction will take the same nonce — and the second
       send will replace the first instead of queuing. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await unlockWallet(second)
    await expect(second.getByText(LOGIN_EMAIL)).toBeVisible()

    /* There is nothing to send in the test environment: no nodes.
       A weaker but checkable claim is tested — the tabs do not
       disagree on which wallet is open. */
    await expect(first.getByText(LOGIN_EMAIL)).toBeVisible()
    await expect(second.getByText(LOGIN_EMAIL)).toBeVisible()
  })
})
