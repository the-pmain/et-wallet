import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { toChainId, type Wei } from '@/core'
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

/**
 * Открывает экран настроек, где живёт управление RPC-узлами.
 *
 * Узлы перенесены с главного экрана намеренно: он отвечает на вопрос
 * «сколько у меня и что происходит», а выбор узла меняет устройство
 * кошелька и требует осознанного захода в настройки.
 */
async function openSettings(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Аккаунт 1')
  await user.click(screen.getByRole('link', { name: 'Настройки' }))
  await screen.findByRole('heading', { name: 'Настройки' })
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Панель RPC: список узлов', () => {
  it('показывает узлы активной сети с указанием источника', async () => {
    renderApp()
    await openSettings()

    expect(screen.getByText('ethereum-rpc.publicnode.com')).toBeInTheDocument()
    expect(screen.getAllByText(/Публичный узел/).length).toBeGreaterThan(0)
  })

  it('отмечает действующий узел', async () => {
    renderApp()
    await openSettings()

    /* Пользователь обязан видеть, к чьему узлу обращается кошелёк:
       оператор узла видит его IP и все запрашиваемые адреса. */
    await waitFor(() => {
      expect(screen.getByText(/используется сейчас/)).toBeInTheDocument()
    })
  })

  it('показывает только имя узла, без пути с ключом', async () => {
    renderApp()
    await openSettings()

    /* Путь адреса содержит ключ доступа. Показанный на экране ключ
       утекает при демонстрации экрана и на скриншотах. */
    expect(screen.queryByText(/https:\/\//)).not.toBeInTheDocument()
  })
})

describe('Панель RPC: проверка доступности', () => {
  it('показывает время ответа исправного узла', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.click(screen.getByRole('button', { name: /проверить/i }))

    await waitFor(() => {
      expect(screen.getAllByLabelText('Доступен').length).toBeGreaterThan(0)
    })
  })

  it('помечает недоступные узлы', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({ unavailable: true })
    await user.click(screen.getByRole('button', { name: /проверить/i }))

    await waitFor(() => {
      expect(screen.getAllByLabelText('Недоступен').length).toBeGreaterThan(0)
    })
  })

  it('отдельно сообщает о чужой сети', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })
    await user.click(screen.getByRole('button', { name: /проверить/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/обслуживает другую сеть/).length).toBeGreaterThan(0)
    })
  })
})

describe('Панель RPC: свой адрес', () => {
  it('добавляет узел и ставит его первым', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.type(screen.getByLabelText('Свой RPC-адрес'), 'https://my-node.example')
    await user.click(screen.getByRole('button', { name: /добавить узел/i }))

    await waitFor(() => {
      expect(screen.getByText('my-node.example')).toBeInTheDocument()
    })
    expect(screen.getByText(/Собственный узел/)).toBeInTheDocument()
  })

  it('показывает причину отказа узла чужой сети', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })

    await user.type(screen.getByLabelText('Свой RPC-адрес'), 'https://wrong-chain.example')
    await user.click(screen.getByRole('button', { name: /добавить узел/i }))

    /* «Узел обслуживает другую сеть» и «узел не отвечает» требуют
       разных действий: подменять первое вторым — вводить в заблуждение. */
    /* Шаблон включает глагол: «chainId 137» встречается и в списке сетей
       строкой Polygon, и такой запрос нашёл бы оба совпадения. */
    await waitFor(() => {
      expect(screen.getByText(/вернул chainId 137/)).toBeInTheDocument()
    })
    expect(screen.queryByText('wrong-chain.example')).not.toBeInTheDocument()
  })

  it('предупреждает, что добавление узла — вопрос доверия', async () => {
    renderApp()
    await openSettings()

    expect(screen.getByText(/недобросовестный узел покажет не то/i)).toBeInTheDocument()
  })

  it('удаляет добавленный узел', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.type(screen.getByLabelText('Свой RPC-адрес'), 'https://my-node.example')
    await user.click(screen.getByRole('button', { name: /добавить узел/i }))

    await waitFor(() => {
      expect(screen.getByText('my-node.example')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Удалить my-node.example' }))

    await waitFor(() => {
      expect(screen.queryByText('my-node.example')).not.toBeInTheDocument()
    })
  })
})
