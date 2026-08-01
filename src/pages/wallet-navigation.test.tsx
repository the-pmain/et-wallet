import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

async function findDashboard(): Promise<HTMLElement> {
  return await screen.findByText('Аккаунт 1')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Навигация кошелька', () => {
  it('показывает все пять разделов', async () => {
    renderApp()
    await findDashboard()

    const navigation = screen.getByRole('navigation', { name: 'Разделы кошелька' })

    for (const label of ['Кошелёк', 'Активы', 'NFT', 'История', 'Настройки']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('открывает раздел активов', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Активы' }))

    expect(await screen.findByRole('heading', { name: 'Активы' })).toBeInTheDocument()
  })

  it('открывает раздел NFT', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'NFT' }))

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
  })

  it('открывает раздел истории', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'История' }))

    expect(await screen.findByRole('heading', { name: 'История' })).toBeInTheDocument()
  })

  it('открывает раздел настроек', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Настройки' }))

    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  })

  it('сохраняет шапку при переходе между разделами', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Активы' }))

    /* Шапка и навигация вынесены в общий маршрут-лейаут: их пересоздание
       на каждом экране давало бы мерцание при переходе. */
    expect(screen.getByText('Аккаунт 1')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Разделы кошелька' })).toBeInTheDocument()
  })
})

describe('Доступ к разделам кошелька', () => {
  it('не пускает к настройкам при заблокированном кошельке', async () => {
    services.onboarding.lock()
    window.location.hash = '#/wallet/settings'

    renderApp()

    /* Прямой переход по адресу обязан приводить к экрану пароля:
       иначе пользователь увидит части интерфейса, доступ к которым
       не подтверждал. */
    expect(await screen.findByText('С возвращением')).toBeInTheDocument()
  })
})

describe('Раздел активов', () => {
  it('предлагает импорт токена', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Активы' }))

    /* Список известных токенов не подставляется: показанный в кошельке
       токен выглядит одобренным, а прислать приманку с именем известного
       проекта может кто угодно. Добавляет пользователь. */
    expect(await screen.findByRole('button', { name: /импорт токена/i })).toBeInTheDocument()
  })

  it('показывает нативную валюту сети', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Активы' }))

    expect(await screen.findByText('Ether')).toBeInTheDocument()
  })
})

describe('Раздел NFT', () => {
  it('объясняет отсутствие поддержки вместо пустой галереи', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'NFT' }))

    expect(await screen.findByText('Коллекционные токены пока не поддержаны')).toBeInTheDocument()
    expect(screen.getByText(/а не что коллекции нет/i)).toBeInTheDocument()
  })

  it('предупреждает о раскрытии IP при загрузке изображений', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'NFT' }))

    expect(await screen.findByText(/видит IP-адрес и связывает его/i)).toBeInTheDocument()
  })
})

describe('Раздел настроек', () => {
  it('переключает оформление', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Настройки' }))
    await user.click(await screen.findByRole('button', { name: 'Тёмная' }))

    expect(document.documentElement).toHaveClass('dark')
  })

  it('содержит управление аккаунтами и сетями', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Настройки' }))

    expect(await screen.findByText('Аккаунты')).toBeInTheDocument()
    expect(screen.getByText('Сети')).toBeInTheDocument()
    expect(screen.getByText('RPC-узлы')).toBeInTheDocument()
  })

  it('даёт выбрать срок автоблокировки', async () => {
    /* Прежняя проверка утверждала, что автоблокировки нет. Она
       появилась, и предупреждение о её отсутствии стало неверным:
       предупреждение о несуществующем ограничении приучает не читать
       остальные. */
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Настройки' }))

    expect(await screen.findByText('Блокировать после бездействия')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15 мин' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('объясняет, чем опасен разблокированный кошелёк', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Настройки' }))

    expect(await screen.findByText(/держит ключи в памяти/i)).toBeInTheDocument()
  })
})
