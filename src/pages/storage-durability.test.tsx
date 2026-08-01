import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_DURABILITY, type Wei } from '@/core'
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

/** Открывает раздел настроек разблокированного кошелька. */
async function openSettings(): Promise<void> {
  await screen.findByText('Аккаунт 1')
  window.location.hash = '#/wallet/settings'

  await screen.findByRole('heading', { name: 'Настройки' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Предупреждение о стойкости хранилища', () => {
  it('хранилище в памяти признаётся непереживающим перезагрузку', async () => {
    /* Тестовая сборка работает на хранилище в памяти, и оно отвечает
       честно. Молчание здесь означало бы, что кошелёк утверждает
       сохранность, которой нет. */
    await expect(services.storage.durability()).resolves.toBe(STORAGE_DURABILITY.Session)
  })

  it('настройки предупреждают, что кошелёк не переживёт вкладку', async () => {
    renderApp()
    await openSettings()

    expect(await screen.findByText(/не переживёт закрытие вкладки/i)).toBeInTheDocument()
  })

  it('предупреждение называет seed-фразу единственным выходом', async () => {
    renderApp()
    await openSettings()

    expect(await screen.findByText(/по записанной seed-фразе/i)).toBeInTheDocument()
  })

  it('устаревшего утверждения про потерю доступа после перезагрузки больше нет', async () => {
    /* Текст был верен, пока хранилище работало в памяти. После
       появления IndexedDB он превратился бы в ложь на экране
       настроек. */
    renderApp()
    await openSettings()

    expect(screen.queryByText(/Хранилище работает в памяти/i)).not.toBeInTheDocument()
  })
})
