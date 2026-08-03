import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { WALLET_BROADCAST, WalletBroadcast } from '@/features/onboarding'
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

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Стирание кошелька в соседней вкладке', () => {
  it('открытый кошелёк закрывается', async () => {
    /* САМЫЙ ОПАСНЫЙ СЛУЧАЙ ДВУХ ВКЛАДОК. Хранилище общее, а память —
       нет: вкладка держит ключ шифрования у себя и о стирании
       не узнаёт. Она продолжала показывать балансы и позволяла
       подписать перевод — то есть человек, стерший кошелёк перед
       передачей устройства, оставлял открытую дверь. */
    renderApp()

    await screen.findByText('Account 1')

    /* Сообщение приходит из другой вкладки: свои назад не возвращаются. */
    const other = new WalletBroadcast(services.broadcastName)

    other.post(WALLET_BROADCAST.Erased)

    await waitFor(() => {
      expect(screen.queryByText('Account 1')).not.toBeInTheDocument()
    })

    other.close()
  })

  it('вкладка возвращается к приветствию', async () => {
    renderApp()
    await screen.findByText('Account 1')

    const other = new WalletBroadcast(services.broadcastName)

    other.post(WALLET_BROADCAST.Erased)

    expect(await screen.findByRole('link', { name: /create a new wallet/i })).toBeInTheDocument()

    other.close()
  })

  it('чужое сообщение кошелёк не закрывает', async () => {
    /* В канал того же источника писать может любой код. Закрывать
       кошелёк по неизвестному сообщению значило бы дать способ мешать
       владельцу работать. */
    renderApp()
    await screen.findByText('Account 1')

    new BroadcastChannel(services.broadcastName).postMessage('lock-everything')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByText('Account 1')).toBeInTheDocument()
  })
})
