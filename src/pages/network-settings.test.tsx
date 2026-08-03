import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, toChainId, type Wei } from '@/core'
import { TEST_MNEMONIC } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

/** Идентификатор, не занятый ни одной встроенной сетью. */
const CUSTOM_CHAIN = 31_337

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/** Открывает экран настроек, где живёт управление сетями. */
async function openSettings(): Promise<void> {
  const user = userEvent.setup()

  await screen.findByText('Account 1')
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Settings' })
}

/** Раскрывает форму добавления сети. */
async function openAddForm(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /Add a network/i }))
  await screen.findByLabelText('Network name')
}

/** Заполняет обязательные поля формы. */
async function fillNetwork(name: string, chainId: number): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Network name'), name)
  await user.type(screen.getByLabelText('Chain ID'), String(chainId))
  await user.type(screen.getByLabelText('RPC endpoint'), 'https://node.example')
  await user.type(screen.getByLabelText('Currency symbol'), 'TST')
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: 0n as Wei })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Сети: список', () => {
  it('перечисляет встроенные сети', async () => {
    renderApp()
    await openSettings()

    /* Запрос ограничен карточкой сетей: имя активной сети встречается
       ещё и в шапке оболочки. */
    const card = screen.getByText('Networks').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText('Ethereum')).toBeInTheDocument()
    expect(within(card).getByText('Polygon')).toBeInTheDocument()
  })

  it('не предлагает удалить встроенную сеть', async () => {
    renderApp()
    await openSettings()

    /* Конфигурация встроенной сети — часть защиты от подмены: удалив
       основную сеть, пользователь мог бы добавить вместо неё
       одноимённую с чужим идентификатором. */
    expect(
      screen.queryByRole('button', { name: /remove network Ethereum/i }),
    ).not.toBeInTheDocument()
  })

  it('переключает активную сеть', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    await user.click(screen.getByText('Polygon'))

    await waitFor(() => {
      expect(
        screen.getByText(`chainId ${BUILT_IN_CHAIN_ID.Polygon.toString()} · POL`),
      ).toBeVisible()
    })
  })
})

describe('Сети: добавление', () => {
  it('добавляет пользовательскую сеть после проверки узла', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })
  })

  it('помечает добавленную сеть как пользовательскую', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* Различие между проверенной встроенной конфигурацией и добавленной
       вручную важно: у второй и узел, и обозреватель заданы тем,
       кто её добавил. */
    await waitFor(() => {
      expect(screen.getByText('custom')).toBeInTheDocument()
    })
  })

  it('предупреждает о подмене при совпадении имени со встроенной сетью', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* Сверка chainId с узлом этого не поймает: узел честно подтвердит
       свой идентификатор. */
    expect(await screen.findByText('The network impersonates an existing one')).toBeInTheDocument()
    expect(screen.getByText(/a common network spoofing trick/i)).toBeInTheDocument()
  })

  it('не добавляет одноимённую сеть без согласия', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await screen.findByText('The network impersonates an existing one')

    expect(screen.queryByText('custom')).not.toBeInTheDocument()
  })

  it('добавляет одноимённую сеть по явному согласию', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await user.click(await screen.findByRole('button', { name: 'Add anyway' }))

    await waitFor(() => {
      expect(screen.getByText('custom')).toBeInTheDocument()
    })
  })

  it('показывает причину отказа узла дословно', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()

    services.providerFactory.configure({
      reportedChainId: toChainId(137n),
      verifyChainIdOnCreate: true,
    })

    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)
    await user.click(screen.getByRole('button', { name: 'Add network' }))

    /* «The node serves a different network» и «адрес недоступен» требуют
       разных действий: обобщение лишило бы пользователя возможности
       понять, что исправлять. */
    /* На экране несколько предупреждений: постоянное о доверии к узлу
       и появившееся сообщение об отказе. Проверяется наличие второго
       среди них, а не единственность роли. */
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '')

      expect(alerts.some((text) => /No RPC endpoints are available|chainId 137/.test(text))).toBe(
        true,
      )
    })
  })

  it('предупреждает, что узел и обозреватель задаёт добавляющий', async () => {
    renderApp()
    await openSettings()
    await openAddForm()

    expect(screen.getByText(/supplied by whoever\s+adds the network/i)).toBeInTheDocument()
  })
})

describe('Сети: удаление', () => {
  it('удаляет пользовательскую сеть', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Remove network My Private Chain' }))

    await waitFor(() => {
      expect(screen.queryByText('My Private Chain')).not.toBeInTheDocument()
    })
  })

  it('возвращает кошелёк на сеть по умолчанию, удалив активную', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Add network' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByText('My Private Chain'))
    await user.click(screen.getByRole('button', { name: 'Remove network My Private Chain' }))

    /* Удаление активной сети обязано оставить кошелёк в рабочем
       состоянии, а не в положении «активной сети нет». */
    await waitFor(() => {
      const list = screen.getByText('Networks').closest('[data-slot=card]') as HTMLElement

      expect(within(list).getByText('Ethereum')).toBeInTheDocument()
    })
  })
})
