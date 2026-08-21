import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

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
  return await screen.findByText('Account 1')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Навигация кошелька', () => {
  it('показывает четыре раздела', async () => {
    renderApp()
    await findDashboard()

    const navigation = screen.getByRole('navigation', { name: 'Wallet sections' })

    for (const label of ['Wallet', 'Assets', 'Activity', 'Settings']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeInTheDocument()
    }

    expect(within(navigation).queryByRole('link', { name: 'NFT' })).not.toBeInTheDocument()
  })

  it('открывает раздел активов', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument()
  })

  it('открывает раздел NFT', async () => {
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
  })

  it('открывает раздел истории', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Activity' }))

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument()
  })

  it('открывает раздел настроек', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('сохраняет шапку при переходе между разделами', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    /* Шапка и навигация вынесены в общий маршрут-лейаут: их пересоздание
       на каждом экране давало бы мерцание при переходе. */
    expect(screen.getByText('Account 1')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Wallet sections' })).toBeInTheDocument()
  })
})

describe('Доступ к разделам кошелька', () => {
  it('не пускает к настройкам при заблокированном кошельке', async () => {
    services.onboarding.lock()
    openPath('/wallet/settings')

    renderApp()

    /* Прямой переход по адресу обязан приводить к экрану пароля:
       иначе пользователь увидит части интерфейса, доступ к которым
       не подтверждал. */
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
  })
})

describe('Раздел активов', () => {
  it('предлагает импорт токена', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    /* Список известных токенов не подставляется: показанный в кошельке
       токен выглядит одобренным, а прислать приманку с именем известного
       проекта может кто угодно. Добавляет пользователь. */
    expect(await screen.findByRole('button', { name: /Import a token/i })).toBeInTheDocument()
  })

  it('показывает нативную валюту сети', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Assets' }))

    expect(await screen.findByText('Ether')).toBeInTheDocument()
  })
})

describe('Раздел NFT', () => {
  it('объясняет границы поиска вместо пустой галереи', async () => {
    /* Пустой список без объяснения читается владельцем как пропажа
       имущества: поиск охватывает окно блоков, а не всю цепь. */
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Searching for items…')).not.toBeInTheDocument()
      expect(screen.getByText('No items found')).toBeInTheDocument()
    })
    expect(screen.getByText(/scans the last/i)).toBeInTheDocument()
  })

  it('предупреждает о раскрытии IP при загрузке изображений', async () => {
    renderApp()
    await findDashboard()

    openPath('/wallet/nft')

    expect(await screen.findByRole('heading', { name: 'NFT' })).toBeInTheDocument()
    expect(await screen.findByText(/would see your IP address/i)).toBeInTheDocument()
  })
})

describe('Раздел настроек', () => {
  it('переключает оформление', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Dark' }))

    expect(document.documentElement).toHaveClass('dark')
  })

  it('содержит управление аккаунтами и сетями', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('Networks')).toBeInTheDocument()
    expect(screen.queryByText('RPC nodes')).not.toBeInTheDocument()
  })

  it('даёт выбрать срок автоблокировки', async () => {
    /* Прежняя проверка утверждала, что автоблокировки нет. Она
       появилась, и предупреждение о её отсутствии стало неверным:
       предупреждение о несуществующем ограничении приучает не читать
       остальные. */
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText('Lock after inactivity')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('объясняет, чем опасен разблокированный кошелёк', async () => {
    const user = userEvent.setup()

    renderApp()
    await findDashboard()

    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText(/keeps the keys in memory/i)).toBeInTheDocument()
  })
})
