import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** 1.5 нативной валюты в минимальных единицах. */
const BALANCE = 1_500_000_000_000_000_000n as Wei

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/**
 * Дожидается появления панели.
 *
 * Признак — имя активного аккаунта в шапке оболочки: оно появляется
 * только после того, как сессия открыта и аккаунт выведен из seed-фразы.
 */
async function findDashboard(): Promise<HTMLElement> {
  return await screen.findByText('Account 1')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Панель: баланс', () => {
  it('показывает баланс нативной валюты активной сети', async () => {
    renderApp()
    await findDashboard()

    expect(await screen.findByText('1.5')).toBeInTheDocument()
    expect(screen.getByText('ETH')).toBeInTheDocument()
  })

  it('называет, что показан баланс нативной валюты, и ведёт в портфель', async () => {
    renderApp()
    await findDashboard()

    /* Прежняя оговорка «балансы ERC-20 не отслеживаются» устарела:
       токены отслеживаются. Предупреждение о несуществующем
       ограничении приучает не читать остальные. */
    expect(
      await screen.findByText(/The native currency of the network is sent here/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /portfolio/i })).toBeInTheDocument()
  })

  it('не подменяет недоступный баланс нулём', async () => {
    services.providerFactory.configure({ unavailable: true })

    renderApp()
    await findDashboard()

    expect(await screen.findByText(/that does not mean the funds\s+are gone/i)).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})

describe('Панель: шапка', () => {
  it('показывает адрес активного аккаунта усечённым', async () => {
    renderApp()
    await findDashboard()

    const expected = TEST_MNEMONIC_ADDRESSES[0] as string
    const shortened = `${expected.slice(0, 6)}…${expected.slice(-6)}`

    expect(screen.getByText(shortened)).toBeInTheDocument()
  })

  it('показывает отпечаток адреса', async () => {
    renderApp()
    await findDashboard()

    /* Отпечаток зависит от всех символов адреса: подменённый адрес меняет
       картинку целиком, и это заметно без вчитывания. */
    expect(screen.getByRole('img', { name: 'Address fingerprint' })).toBeInTheDocument()
  })

  it('называет активную сеть и у суммы, и в шапке', async () => {
    renderApp()
    await findDashboard()

    /* Дважды — намеренно, и это не тот дубль, что убирают. В шапке
       сеть названа как общий признак положения, действующий на всех
       экранах; у суммы — как ответ на вопрос, чьи это деньги. Один
       адрес в разных сетях держит разные средства, и цифра без
       указания сети неполна. */
    expect(screen.getAllByText('Ethereum')).toHaveLength(2)
  })
})

describe('Панель: операции', () => {
  it('объясняет пустую историю вместо молчаливого пропуска', async () => {
    renderApp()
    await findDashboard()

    expect(await screen.findByText('No operations yet')).toBeInTheDocument()
    expect(screen.getByText(/the limits of the\s+source/i)).toBeInTheDocument()
  })

  it('ведёт на весь список операций', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getByRole('link', { name: /all activity/i })).toBeInTheDocument()
  })
})

describe('Панель: быстрые действия', () => {
  it('ведёт на экран отправки', async () => {
    renderApp()
    await findDashboard()

    /* `HashRouter` формирует адрес через хэш: путь без него означал бы
       переход, который в расширении привёл бы к попытке загрузить
       несуществующий файл. */
    expect(screen.getByRole('link', { name: /send/i })).toHaveAttribute('href', '#/wallet/send')
  })

  it('называет, что отправляется нативная валюта, а не токены', async () => {
    renderApp()
    await findDashboard()

    /* При переводе ERC-20 получатель лежит в данных вызова, а не в поле
       получателя транзакции: сводить обе операции к одной форме значило бы
       показать пользователю не то, что он подписывает. */
    expect(screen.getByText(/The native currency of the network is sent here/i)).toBeInTheDocument()
  })

  it('показывает полный адрес для получения, а не усечённый', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('button', { name: /Receive/i }))

    /* Усечённый адрес невозможно сверить посимвольно, а именно сверка
       защищает от подмены буфера обмена. */
    expect(screen.getByText(TEST_MNEMONIC_ADDRESSES[0] as string)).toBeInTheDocument()
    expect(screen.getByText(/Check the address\s+character by character/i)).toBeInTheDocument()
  })

  it('блокирует кошелёк и возвращает экран ввода пароля', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('button', { name: 'Lock the wallet' }))

    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })
})

/**
 * Переход между экранами должен быть заметен не только глазами.
 *
 * Без перевода фокуса нажатие пункта панели подменяло содержимое,
 * фокус оставался на ссылке, и тому, кто страницу слушает, ничего
 * не объявлялось: переход существовал только для зрячих.
 */
describe('Панель: переход между экранами', () => {
  it('не отнимает фокус при открытии приложения', async () => {
    renderApp()
    await findDashboard()

    /* Человек ещё никуда не переходил. Перехваченный фокус сбил бы
       того, кто уже начал обход клавишей. */
    expect(document.activeElement).not.toBe(document.querySelector('main'))
  })

  it('переводит фокус в содержимое после перехода', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))
    await screen.findByRole('heading', { level: 1, name: 'Assets' })

    /* Фокус на области содержимого, а не на заголовке: заголовок есть
       не у всех экранов, а область есть всегда, и программа чтения
       начинает читать её сверху. */
    expect(document.activeElement).toBe(document.querySelector('main'))
  })
})
