import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { writeLoginCredentials } from '@/features/onboarding'
import {
  createTestAppServices,
  mockDirectoryAndPriceFetch,
  type ITestAppServices,
} from '@/test/doubles'

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

    expect((await screen.findAllByText('1.5')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ETH').length).toBeGreaterThan(0)
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

  it('называет активную сеть у суммы', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getAllByText('Ethereum')).toHaveLength(1)
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

  it('ставит витрину активов и таблицу курсов перед недавними операциями', async () => {
    renderApp()
    await findDashboard()

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(await screen.findByText('Ether')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all assets/i })).toHaveAttribute(
      'href',
      '/wallet/assets',
    )
    expect(screen.getByRole('heading', { name: 'Cryptocurrency Prices' })).toBeInTheDocument()
  })
})

describe('Панель: быстрые действия', () => {
  it('ведёт на экран отправки', async () => {
    renderApp()
    await findDashboard()

    expect(screen.getByRole('link', { name: /send/i })).toHaveAttribute('href', '/wallet/send')
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

describe('Панель: кабинет справочника', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    localStorage.clear()
  })

  it('после создания и после входа показывает фиат, а не эфир', async () => {
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

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$12.50')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /send/i })).toBeInTheDocument()
    expect(screen.queryByText('1.5')).not.toBeInTheDocument()
    expect(screen.queryByText('ETH')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assets' })).toBeInTheDocument()
    expect(screen.getByText('No assets yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Receive/i })).toBeEnabled()
    expect((await screen.findAllByText('Account 1')).length).toBeGreaterThan(0)
  })

  it('на главном экране показывает токены из users.assets', async () => {
    globalThis.fetch = mockDirectoryAndPriceFetch({
      id: '7',
      email: 'james@example.com',
      balance: '0',
      createdAt: '2026-08-19T12:00:00.000Z',
      assets: {
        quoteCurrency: 'USD',
        updatedAt: '2026-08-20T12:00:00.000Z',
        tokens: [
          {
            chainId: '1',
            standard: 'native',
            address: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balance: '1284700000000000000',
            isVerified: true,
          },
          {
            chainId: '1',
            standard: 'ERC-20',
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            balance: '2500000000',
            isVerified: true,
          },
        ],
      },
    })

    writeLoginCredentials({
      id: '7',
      email: 'james@example.com',
      theP: PASSWORD,
    })

    renderApp()

    expect(await screen.findByText('$6,719.11')).toBeInTheDocument()
    expect(screen.getByText('Ether')).toBeInTheDocument()
    expect(screen.getAllByText('USD Coin').length).toBeGreaterThan(0)
    expect(screen.getByText('1.2847')).toBeInTheDocument()
    expect(screen.getByText('2500')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all assets/i })).toHaveAttribute(
      'href',
      '/wallet/assets',
    )
  })
})
