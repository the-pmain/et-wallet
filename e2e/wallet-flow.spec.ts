import { expect, test, type Page } from '@playwright/test'

/**
 * Тестовая мнемоническая фраза нулевой энтропии.
 *
 * Общеотраслевой вектор. Средства на её адресах не принадлежат никому,
 * поэтому она пригодна для проверок и непригодна ни для чего другого.
 */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const PASSWORD = 'Korova-7-Luna!'

/** Первый адрес тестовой фразы по пути `m/44'/60'/0'/0/0`. */
const FIRST_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

/**
 * Разворачивает кошелёк из тестовой фразы.
 *
 * Хранилище работает в памяти, поэтому каждая проверка начинается
 * с чистого состояния и разворачивает кошелёк заново.
 */
async function importWallet(page: Page): Promise<void> {
  await page.goto('/#/import')

  await page.getByLabel('Seed phrase').fill(TEST_MNEMONIC)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Repeat the password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Import' }).click()

  await expect(page.getByText('Account 1')).toBeVisible()
}

test.describe('Сквозной путь: создание и работа кошелька', () => {
  test('экран приветствия открывается собранным приложением', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeVisible()
  })

  test('кошелёк восстанавливается по seed-фразе', async ({ page }) => {
    await importWallet(page)

    /* Адрес выведен настоящим BIP-32 в собранном коде: совпадение
       с известным значением подтверждает, что деривация пережила
       сборку и отсечение неиспользуемого. */
    await expect(page.getByText('0x9858…aEda94')).toBeVisible()
  })

  test('разделы кошелька открываются: чанки загружаются', async ({ page }) => {
    /* Экран, чанк которого не загрузился, в проверках на jsdom
       выглядит исправным: там `import()` разрешается немедленно. */
    await importWallet(page)

    for (const [hash, heading] of [
      ['#/wallet/activity', 'Activity'],
      ['#/wallet/assets', 'Assets'],
      ['#/wallet/portfolio', 'Portfolio'],
      ['#/wallet/settings', 'Settings'],
      ['#/wallet/nft', 'NFT'],
      ['#/wallet/connections', 'Connections'],
      ['#/wallet/backup', 'Backup'],
    ] as const) {
      await page.goto(`/${hash}`)

      /* Заголовок первого уровня, а не любой: на экране подключений
         есть карточка «Active connections», и нестрогий поиск
         нашёл бы оба. */
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }
  })

  test('заблокированный кошелёк не показывает разделов', async ({ page }) => {
    /* Прямой переход по адресу при заблокированном кошельке обязан
       приводить к экрану пароля, а не к содержимому. */
    await importWallet(page)

    await page.goto('/#/wallet/settings')
    await page.getByRole('button', { name: 'Lock the wallet' }).click()

    await page.goto('/#/wallet/settings')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()
  })

  test('кошелёк переживает перезагрузку страницы', async ({ page }) => {
    /*
      ГЛАВНАЯ ПРОВЕРКА ПОСТОЯННОГО ХРАНИЛИЩА. До его появления кошелёк
      исчезал вместе со вкладкой, и пользоваться им с настоящими
      средствами было нельзя.

      После перезагрузки кошелёк обязан оказаться ЗАБЛОКИРОВАННЫМ,
      а не открытым: сессионный ключ шифрования живёт в памяти
      и не сохраняется — иначе перезагрузка обходила бы пароль.
    */
    await importWallet(page)

    await page.reload()

    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('link', { name: /create a new wallet/i })).toBeHidden()
  })

  test('подбор пароля упирается в растущую задержку', async ({ page }) => {
    /*
      Ограничитель попыток. Проверяется в собранном приложении, потому
      что счётчик лежит в IndexedDB, а он и есть то, что делает задержку
      непреодолимой перезагрузкой.

      Число попыток берётся с запасом: точный порог задан в ядре
      и проверен модульно, здесь важно, что задержка вообще наступает.
    */
    await importWallet(page)
    await page.reload()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel('Password').fill('Sobaka-9-Solnce!')
      await page.getByRole('button', { name: 'Unlock' }).click()
      await page.waitForTimeout(150)
    }

    await expect(page.getByText(/Too many attempts/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  })

  test('задержка переживает перезагрузку страницы', async ({ page }) => {
    /* Ограничитель, обнуляемый обновлением страницы, не ограничивает
       ничего: подбирающий нажимает F5 после каждой неудачи. */
    await importWallet(page)
    await page.reload()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByLabel('Password').fill('Sobaka-9-Solnce!')
      await page.getByRole('button', { name: 'Unlock' }).click()
      await page.waitForTimeout(150)
    }

    await expect(page.getByText(/Too many attempts/i)).toBeVisible()

    await page.reload()

    await expect(page.getByText(/Too many attempts/i)).toBeVisible()
  })

  test('после перезагрузки кошелёк открывается тем же паролем', async ({ page }) => {
    await importWallet(page)
    await page.reload()

    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: /unlock/i }).click()

    /* Тот же адрес, что и до перезагрузки: расшифрована та же фраза. */
    await expect(page.getByText('0x9858…aEda94')).toBeVisible()
  })
})

test.describe('Сквозной путь: отправка', () => {
  test('форма не пускает дальше с непригодным получателем', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/send')

    await page.getByLabel(/Recipient address/).fill('0x123')
    await page.getByLabel(/Amount/).fill('1')

    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  test('получатель с верным адресом принимается', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/send')

    await page.getByLabel(/Recipient address/).fill(FIRST_ADDRESS)
    await page.getByLabel(/Amount/).fill('0.0001')

    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  test('выбор актива предлагает нативную валюту', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/send')

    /* Список активов собирается из отслеживаемых токенов, и нативная
       валюта в нём есть всегда: её нельзя убрать. Пустой список означал
       бы, что отправить нечего вовсе. */
    await expect(page.getByLabel('What to send')).toHaveValue('native')
  })
})

test.describe('Сквозной путь: резервная копия', () => {
  test('seed-фраза не выдаётся без пароля и отметки', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()

    await expect(page.getByRole('button', { name: 'Show the phrase' })).toBeDisabled()
    await expect(page.getByText('about')).toBeHidden()
  })

  /* Поле уточняется точным совпадением: на экране копии есть второе
     поле пароля — у проверки записанного, — и подстрока совпадает
     с обоими. */
  test('фраза выдаётся после отметки и верного пароля', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Show the phrase' }).click()

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page.getByText('about')).toBeVisible()
  })

  test('неверный пароль фразу не выдаёт', async ({ page }) => {
    await importWallet(page)
    await page.goto('/#/wallet/backup')

    await page.getByRole('button', { name: 'Show the seed phrase' }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Show the phrase' }).click()

    await page.getByLabel('Password', { exact: true }).fill('Sobaka-9-Solnce!')
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page.getByText('Wrong password.')).toBeVisible()
    await expect(page.getByText('about')).toBeHidden()
  })
})
