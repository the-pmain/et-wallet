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

  await screen.findByText('Аккаунт 1')
  await user.click(screen.getByRole('link', { name: 'Настройки' }))
  await screen.findByRole('heading', { name: 'Настройки' })
}

/** Раскрывает форму добавления сети. */
async function openAddForm(): Promise<void> {
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: /добавить сеть/i }))
  await screen.findByLabelText('Название сети')
}

/** Заполняет обязательные поля формы. */
async function fillNetwork(name: string, chainId: number): Promise<void> {
  const user = userEvent.setup()

  await user.type(screen.getByLabelText('Название сети'), name)
  await user.type(screen.getByLabelText('Идентификатор сети'), String(chainId))
  await user.type(screen.getByLabelText('RPC-адрес'), 'https://node.example')
  await user.type(screen.getByLabelText('Символ валюты'), 'TST')
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
    const card = screen.getByText('Сети').closest('[data-slot=card]') as HTMLElement

    expect(within(card).getByText('Ethereum')).toBeInTheDocument()
    expect(within(card).getByText('Polygon')).toBeInTheDocument()
  })

  it('не предлагает удалить встроенную сеть', async () => {
    renderApp()
    await openSettings()

    /* Конфигурация встроенной сети — часть защиты от подмены: удалив
       основную сеть, пользователь мог бы добавить вместо неё
       одноимённую с чужим идентификатором. */
    expect(screen.queryByRole('button', { name: /удалить сеть Ethereum/i })).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))

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

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))

    /* Различие между проверенной встроенной конфигурацией и добавленной
       вручную важно: у второй и узел, и обозреватель заданы тем,
       кто её добавил. */
    await waitFor(() => {
      expect(screen.getByText('своя')).toBeInTheDocument()
    })
  })

  it('предупреждает о подмене при совпадении имени со встроенной сетью', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))

    /* Сверка chainId с узлом этого не поймает: узел честно подтвердит
       свой идентификатор. */
    expect(await screen.findByText('Сеть выдаёт себя за существующую')).toBeInTheDocument()
    expect(screen.getByText(/типичный приём подмены сети/i)).toBeInTheDocument()
  })

  it('не добавляет одноимённую сеть без согласия', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))
    await screen.findByText('Сеть выдаёт себя за существующую')

    expect(screen.queryByText('своя')).not.toBeInTheDocument()
  })

  it('добавляет одноимённую сеть по явному согласию', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('Ethereum', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))
    await user.click(await screen.findByRole('button', { name: 'Всё равно добавить' }))

    await waitFor(() => {
      expect(screen.getByText('своя')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))

    /* «Узел обслуживает другую сеть» и «адрес недоступен» требуют
       разных действий: обобщение лишило бы пользователя возможности
       понять, что исправлять. */
    /* На экране несколько предупреждений: постоянное о доверии к узлу
       и появившееся сообщение об отказе. Проверяется наличие второго
       среди них, а не единственность роли. */
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '')

      expect(alerts.some((text) => /Нет доступных RPC-узлов|chainId 137/.test(text))).toBe(true)
    })
  })

  it('предупреждает, что узел и обозреватель задаёт добавляющий', async () => {
    renderApp()
    await openSettings()
    await openAddForm()

    expect(screen.getByText(/задаёт тот, кто\s+добавляет сеть/i)).toBeInTheDocument()
  })
})

describe('Сети: удаление', () => {
  it('удаляет пользовательскую сеть', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSettings()
    await openAddForm()
    await fillNetwork('My Private Chain', CUSTOM_CHAIN)

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Удалить сеть My Private Chain' }))

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

    await user.click(screen.getByRole('button', { name: 'Добавить сеть' }))
    await waitFor(() => {
      expect(screen.getByText('My Private Chain')).toBeInTheDocument()
    })

    await user.click(screen.getByText('My Private Chain'))
    await user.click(screen.getByRole('button', { name: 'Удалить сеть My Private Chain' }))

    /* Удаление активной сети обязано оставить кошелёк в рабочем
       состоянии, а не в положении «активной сети нет». */
    await waitFor(() => {
      const list = screen.getByText('Сети').closest('[data-slot=card]') as HTMLElement

      expect(within(list).getByText('Ethereum')).toBeInTheDocument()
    })
  })
})
