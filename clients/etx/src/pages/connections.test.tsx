import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DAPP_REQUEST_KIND,
  toAddress,
  toChainId,
  type Address,
  type HexString,
  type IDappRequest,
  type Wei,
} from '@/core'
import { TEST_MNEMONIC, TEST_MNEMONIC_ADDRESSES } from '@/core/hdwallet/vectors'
import { TransactionRepository } from '@/core/transaction/TransactionRepository'
import { createTestAppServices, type ITestAppServices } from '@/test/doubles'
import { openPath } from '@/test/open-path'

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
  await screen.findByText('Account 1')
  openPath('/wallet/connections')

  await screen.findByRole('heading', { name: 'Connections' })

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
    payload: {
      kind: DAPP_REQUEST_KIND.SignMessage,
      address,
      message: 'Sign in to the application',
    },
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

    expect(screen.getByText('No connections')).toBeInTheDocument()
  })

  it('называет, что видит сервер WalletConnect', async () => {
    /* Relay видит адреса и время каждого запроса — утечка уровня
       индексатора, и умалчивать о ней нельзя. */
    renderApp()
    await openConnections()

    expect(screen.getByText(/sees the addresses of your accounts/i)).toBeInTheDocument()
  })

  it('предупреждает не вставлять ссылки из писем', async () => {
    renderApp()
    await openConnections()

    expect(screen.getByText(/Do not paste links/i)).toBeInTheDocument()
  })
})

describe('Подключения: предложение', () => {
  it('показывает предложение с перечнем прав', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/The application will get/i)).toBeInTheDocument()
    expect(screen.getByText(/the seed phrase or the private keys/i)).toBeInTheDocument()
  })

  it('предупреждает, что имя приложения непроверяемо', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])

    expect(await screen.findByText(/Anyone can claim to be a/i)).toBeInTheDocument()
  })

  it('подключает по согласию', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitProposal('p1', [ETHEREUM])
    await user.click(await screen.findByRole('button', { name: 'Allow the connection' }))

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
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

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

    expect(await screen.findByText('Sign in to the application')).toBeInTheDocument()
  })

  it('предупреждает о разрешении на токены', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(
      await screen.findByText('This signature hands over control of your tokens'),
    ).toBeInTheDocument()
  })

  it('предупреждает о неограниченной сумме', async () => {
    /* Именно так отдают доступ ко всем токенам, не увидев ни списания,
       ни комиссии. */
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(unlimitedPermitRequest())

    expect(await screen.findByText('The approved amount is unlimited')).toBeInTheDocument()
  })

  it('оговаривает, что подпись не отзывается', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())

    expect(await screen.findByText(/A signature cannot be revoked/i)).toBeInTheDocument()
  })

  it('подписывает после подтверждения и пароля', async () => {
    /* Пароль спрашивается по той же настройке, что и при отправке
       из кошелька: удалённый запрос не может быть защищён слабее
       собственного действия владельца. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(services.dappTransport.responses).toHaveLength(1)
    })

    const response = services.dappTransport.responses[0]?.response

    expect(response?.kind).toBe('approved')
    expect(response?.kind === 'approved' ? response.result : '').toMatch(/^0x[0-9a-f]+$/i)
  })

  it('без пароля подпись не выполняется', async () => {
    /* Приложение, дождавшееся разблокировки кошелька, не должно
       получать подпись одним нажатием. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(services.dappTransport.responses).toHaveLength(0)
  })

  it('неверный пароль подпись не выдаёт', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    await user.type(await screen.findByLabelText('Password'), 'Sobaka-9-Solnce!')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
    expect(services.dappTransport.responses).toHaveLength(0)
  })

  it('отклоняет по отказу и не подписывает', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(messageRequest())
    await user.click(await screen.findByRole('button', { name: 'Reject' }))

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

    expect(screen.queryByText('Sign in to the application')).not.toBeInTheDocument()
  })
})

describe('Подключения: отключение сессий', () => {
  it('показывает действующее подключение и разрывает его', async () => {
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitConnected({
      id: 'session-1',
      dapp: { name: 'Exchange', url: 'https://example.com', description: null, iconUrl: null },
      chainIds: [ETHEREUM],
      addresses: [OWNER],
      connectedAt: 0,
      expiresAt: null,
    })

    expect(await screen.findByText('Exchange')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Disconnect Exchange/i }))

    await waitFor(() => {
      expect(services.dappTransport.disconnected).toEqual(['session-1'])
    })
  })
})

describe('Подключения: развёртывание контракта', () => {
  /** Запрос без получателя: так приложение просит развернуть контракт. */
  function deploymentRequest(): IDappRequest {
    return {
      id: 'req-3',
      sessionId: 'session-1',
      dapp: { name: 'Пример', url: 'https://example.com', description: null, iconUrl: null },
      chainId: ETHEREUM,
      payload: {
        kind: DAPP_REQUEST_KIND.SendTransaction,
        transaction: {
          from: OWNER,
          to: null,
          value: 0n,
          data: '0x60806040' as HexString,
          gasLimit: null,
        },
      },
    }
  }

  it('предупреждает, что запрос создаёт контракт', async () => {
    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(deploymentRequest())

    expect(await screen.findByText('A contract is being deployed')).toBeInTheDocument()
  })

  it('подписывается развёртывание, а не перевод самому себе', async () => {
    /* Прежде получатель подменялся адресом отправителя: пользователь
       одобрял создание контракта, а подписывал перевод себе с байт-кодом
       в данных вызова — газ списывался, одобренная операция
       не выполнялась. */
    const user = userEvent.setup()

    renderApp()
    await openConnections()

    services.dappTransport.emitRequest(deploymentRequest())
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    await user.type(await screen.findByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(services.dappTransport.responses).toHaveLength(1)
    })

    /* Транзакция без получателя сериализуется с пустым полем `to`.
       Разобрать её обратно можно из хранилища: запись отправки
       сохраняет то, что ушло в сеть. */
    const saved = await new TransactionRepository(services.secureStorage).findByAddress(
      OWNER,
      ETHEREUM,
    )

    expect(saved).toHaveLength(1)
    expect(saved[0]?.to).toBeNull()
  })
})
