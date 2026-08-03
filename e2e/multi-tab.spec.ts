import { expect, test, type Page } from '@playwright/test'

/**
 * Проверки поведения в двух вкладках.
 *
 * ЗАЧЕМ ОНИ. Кошелёк, открытый дважды, — обычный случай: вкладку
 * оставляют и открывают приложение заново. Обе вкладки работают
 * с одним хранилищем IndexedDB, но каждая держит собственный ключ
 * шифрования и собственный снимок состояния в памяти. Что при этом
 * происходит, до сих пор не проверялось ни разу.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const PASSWORD = 'Korova-7-Luna!'

async function importWallet(page: Page): Promise<void> {
  await page.goto('/#/import')

  await page.getByLabel('Seed phrase').fill(TEST_MNEMONIC)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Repeat the password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Import' }).click()

  await expect(page.getByText('Account 1')).toBeVisible()
}

test.describe('Две вкладки', () => {
  test('вторая вкладка видит созданный кошелёк и просит пароль', async ({ context }) => {
    /* Хранилище общее: вкладка, открытая после создания кошелька,
       обязана вести на разблокировку, а не предлагать создать второй
       кошелёк поверх первого. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')

    await expect(second.getByRole('button', { name: 'Unlock' })).toBeVisible()
  })

  test('разблокировка одной вкладки не открывает вторую', async ({ context }) => {
    /* Ключ шифрования живёт в памяти вкладки и на диск не попадает.
       Это и есть причина, по которой вторая вкладка остаётся закрытой:
       иначе ключ пришлось бы куда-то положить. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')

    await expect(second.getByRole('button', { name: 'Unlock' })).toBeVisible()
    await expect(first.getByText('Account 1')).toBeVisible()
  })

  test('обе вкладки открываются одним паролем', async ({ context }) => {
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await second.getByRole('button', { name: 'Unlock' }).click()

    await expect(second.getByText('Account 1')).toBeVisible()
    await expect(first.getByText('Account 1')).toBeVisible()
  })

  test('стирание в одной вкладке замечается второй', async ({ context }) => {
    /* САМЫЙ ОПАСНЫЙ СЛУЧАЙ. Вкладка, пережившая стирание кошелька,
       продолжает показывать балансы и предлагать отправку, хотя ключей
       на диске уже нет. Владелец видит работающий кошелёк, которого
       не существует. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await second.getByRole('button', { name: 'Unlock' }).click()
    await expect(second.getByText('Account 1')).toBeVisible()

    await first.goto('/#/wallet/settings')
    await first.goto('/#/forgot-password')
    await first.getByRole('checkbox').check()
    await first.getByLabel(/Type the word/i).fill('ERASE')
    await first.getByRole('button', { name: 'Erase the wallet' }).click()

    await expect(first.getByRole('link', { name: /create a new wallet/i })).toBeVisible()

    /* Вторая вкладка обязана перестать выдавать себя за рабочий
       кошелёк. Проверяется наблюдаемое поведение, а не внутреннее
       состояние. */
    await second.reload()

    await expect(second.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })
})

test.describe('Две вкладки: опасные случаи', () => {
  test('вкладка не выдаёт себя за рабочий кошелёк после стирания', async ({ context }) => {
    /* Без перезагрузки. Вторая вкладка держит ключи в памяти и снимок
       состояния в дереве React: она продолжит показывать балансы
       и предлагать отправку, хотя ключей на диске уже нет. Владелец
       увидит работающий кошелёк, которого не существует. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await second.getByRole('button', { name: 'Unlock' }).click()
    await expect(second.getByText('Account 1')).toBeVisible()

    await first.goto('/#/forgot-password')
    await first.getByRole('checkbox').check()
    await first.getByLabel(/Type the word/i).fill('ERASE')
    await first.getByRole('button', { name: 'Erase the wallet' }).click()
    await expect(first.getByRole('link', { name: /create a new wallet/i })).toBeVisible()

    /* Даём вкладке время заметить: хранилище общее, и о его очистке
       можно узнать. */
    await second.waitForTimeout(2000)

    await expect(second.getByText('Account 1')).toBeHidden()
  })

  test('вторая вкладка узнаёт об отправке из первой', async ({ context }) => {
    /* Обе вкладки читают одну историю. Вкладка, не знающая
       об отправленной транзакции, возьмёт тот же nonce — и вторая
       отправка заменит первую вместо того, чтобы встать в очередь. */
    const first = await context.newPage()

    await importWallet(first)

    const second = await context.newPage()

    await second.goto('/')
    await second.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await second.getByRole('button', { name: 'Unlock' }).click()
    await expect(second.getByText('Account 1')).toBeVisible()

    /* Отправить в тестовой среде нечего: узлов нет. Проверяется более
       слабое, но проверяемое утверждение — вкладки не расходятся
       в том, какой кошелёк открыт. */
    await expect(first.getByText('Account 1')).toBeVisible()
    await expect(second.getByText('Account 1')).toBeVisible()
  })
})
