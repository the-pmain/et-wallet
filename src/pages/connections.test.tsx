import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DAPP_REQUEST_KIND,
  toAddress,
  toChainId,
  type Address,
  type IDappRequest,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'

import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'

const PASSWORD = 'Korova-7-Luna!'

const BALANCE = 1_000_000_000_000_000_000n as Wei

const ETHEREUM = toChainId(1n)

const OWNER = toAddress(TEST_MNEMONIC_ADDRESSES[0] as string)
const SPENDER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')
const TOKEN = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

let services: ITestAppServices

function renderApp() {
  return render(
    <AppProviders services={services}>
      <AppRouter />
    </AppProviders>,
  )
}

/**
 * Открывает экран подключений и дожидается готовности транспорта.
 *
 * ОЖИДАНИЕ ОБЯЗАТЕЛЬНО. Подписка на события создаётся внутри `init`,
 * то есть асинхронно. Событие, посланное до этого момента, теряется —
 * и тест падает не потому, что экран сломан, а потому, что опередил
 * подписку.
 */
async function openConnections(): Promise<void> {
  await screen.findByText('Аккаунт 1')
  window.location.hash = '#/wallet/connections'

  await screen.findByRole('heading', { name: 'Подключения' })

  await waitFor(() => {
    expect(services.dappSessions.getSnapshot().isReady).toBe(true)
  })
}

/** Запрос на подпись сообщения. */
function messageRequest(address: Address = OWNER): IDappRequest {
  return {
    id: 'req-1',
    sessionId: 'session-1',
    dapp: { name: 'Пример', url: 'https://example.com', description: null, iconUrl: null },
    chainId: ETHEREUM,
    payload: { kind: DAPP_REQUEST_KIND.SignMessage, address, message: 'Войти в приложение' },
  }
}

/** Запрос на подпись разрешения с неограниченной суммой. */
function unlimitedPermitRequest(): IDappRequest {
  return {
    id: 'req-2',
    sessionId: 'session-1',
    dapp: { name: 'Пример', url: 'https://example.com', description: null, iconUrl: null },
    chainId: ETHEREUM,
    payload: {
      kind: DAPP_REQUEST_KIND.SignTypedData,
      address: OWNER,
      typedData: {
        domain: { name: 'USD Coin', chainId: ETHEREUM, verifyingContract: TOKEN },
        types: { Permit: [{ name: 'value', type: 'uint256' }] },
        primaryType: 'Permit',
        message: { owner: OWNER, spender: SPENDER, value: (2n ** 256n - 1n).toString() },
      },
    },
  }
}

beforeEach(async () => {
  window.location.hash = ''
  services = createTestAppServices()
  services.providerFactory.configure({ balance: BALANCE })

  await services.onboarding.importWallet(TEST_MNEMONIC, PASSWORD)
})

describe('Подключения: экран', () => {
  it('открывается и сообщает об отсутствии подключений', async () => {
    renderApp()
    await openConnections()

    expect(screen.getByText('Подключений нет')).toBeInTheDocument()
  })

  it('называет, что видит сервер WalletConnect', async () => {
    /* Relay видит адреса и время каждого запроса — утечка уровня
       индексатора, и умалчивать о ней нельзя. */
    renderApp()
    await openConnections()

    expect(screen.getByText(/видит адреса ваших аккаунтов/i)).toBeInTheDocument()
  })

  it('предупреждает не вставлять ссылки из писем', async () => {
    renderApp()
    await openConnections()

    expect(screen.getByText(/Не вставляйте сюда ссылки/i)).toBeInTheDocument()
  })
})

describe('Подключения: предложение', () => {
  it('показывает предложение с перечнем прав', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/Приложение получит/i)).toBeInTheDocument()
    expect(screen.getByText(/seed-фразу и приватные ключи/i)).toBeInTheDocument()
  })

  it('предупреждает, что имя приложения непроверяемо', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/Назваться известным сервисом/i)).toBeInTheDocument()
  })

  it('подключает по согласию', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])
    await user.click(await screen.findByRole('button', { name: 'Разрешить подключение' }))

    await waitFor(() => {
      expect(services.dappTransport.proposalAnswers).toHaveLength(1)
    })
    expect(services.dappTransport.lastApprovedAddresses()).toContain(OWNER)
  })

  it('отказ отправляется приложению', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])
    await user.click(await screen.findByRole('button', { name: 'Отклонить' }))

    await waitFor(() => {
      expect(services.dappTransport.proposalAnswers.at(-1)?.[1]).toBeNull()
    })
  })
})

describe('Подключения: запрос подписи', () => {
  it('показывает текст сообщения, а не хэш', async () => {
    /* Хэш не говорит пользователю ничего, и он подтверждает вслепую. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())

    expect(await screen.findByText('Войти в приложение')).toBeInTheDocument()
  })

  it('предупреждает о разрешении на токены', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(await screen.findByText('Подпись отдаёт распоряжение токенами')).toBeInTheDocument()
  })

  it('предупреждает о неограниченной сумме', async () => {
    /* Именно так отдают доступ ко всем токенам, не увидев ни списания,
       ни комиссии. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(await screen.findByText('Сумма разрешения не ограничена')).toBeInTheDocument()
  })

  it('оговаривает, что подпись не отзывается', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())

    expect(await screen.findByText(/Подпись отозвать невозможно/i)).toBeInTheDocument()
  })

  it('подписывает по подтверждению', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Подтвердить' }))

    await waitFor(() => {
      expect(services.dappTransport.responses).toHaveLength(1)
    })

    const response = services.dappTransport.responses[0]?.response

    expect(response?.kind).toBe('approved')
    expect(response?.kind === 'approved' ? response.result : '').toMatch(/^0x[0-9a-f]+$/i)
  })

  it('отклоняет по отказу и не подписывает', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Отклонить' }))

    await waitFor(() => {
      expect(services.dappTransport.responses.at(-1)?.response.kind).toBe('rejected')
    })
  })

  it('запрос от чужого адреса отклоняется без вопроса', async () => {
    /* Подписать чужим адресом всё равно нечем, а лишний экран приучает
       нажимать «подтвердить», не читая. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest(SPENDER))

    await waitFor(() => {
      expect(services.dappTransport.responses.at(-1)?.response.kind).toBe('rejected')
    })

    expect(screen.queryByText('Войти в приложение')).not.toBeInTheDocument()
  })
})

describe('Подключения: отключение сессий', () => {
  it('показывает действующее подключение и разрывает его', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitConnected({
      id: 'session-1',
      dapp: { name: 'Биржа', url: 'https://example.com', description: null, iconUrl: null },
      chainIds: [ETHEREUM],
      addresses: [OWNER],
      connectedAt: 0,
      expiresAt: null,
    })

    expect(await screen.findByText('Биржа')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Отключить Биржа/i }))

    await waitFor(() => {
      expect(services.dappTransport.disconnected).toEqual(['session-1'])
    })
  })
})
