import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DAPP_REQUEST_KIND,
  toAddress,
  toChainId,
  type Address,
  type ChainId,
  type IDappRequest,
} from '@/core'
import { FakeSessionTransport, NullLogger } from '@/test/doubles'

import { DappSessionService } from './DappSessionService'

const ETHEREUM = toChainId(1n)
const POLYGON = toChainId(137n)
const UNKNOWN_CHAIN = toChainId(999_999n)

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const STRANGER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

let transport: FakeSessionTransport
let service: DappSessionService
let execute: ReturnType<typeof vi.fn<(request: IDappRequest) => Promise<string>>>

/** Запрос на подпись сообщения от заданного адреса. */
function messageRequest(address: Address, id = 'req-1', chainId: ChainId = ETHEREUM): IDappRequest {
  return {
    id,
    sessionId: 'session',
    dapp: { name: 'Пример', url: 'https://example.com', description: null, iconUrl: null },
    chainId,
    payload: { kind: DAPP_REQUEST_KIND.SignMessage, address, message: 'Войти' },
  }
}

beforeEach(async () => {
  transport = new FakeSessionTransport()
  execute = vi.fn<(request: IDappRequest) => Promise<string>>(() => Promise.resolve('0xsignature'))

  service = new DappSessionService({
    transport,
    logger: new NullLogger(),
    getAddresses: () => [OWNER],
    getActiveChainId: () => ETHEREUM,
    getAvailableChainIds: () => [ETHEREUM, POLYGON],
    execute,
  })

  await service.init()
})

describe('Подготовка транспорта', () => {
  it('после запуска раздел готов к работе', () => {
    expect(service.getSnapshot().isReady).toBe(true)
    expect(service.getSnapshot().error).toBeNull()
  })

  it('повторная попытка после отказа не выполняется', async () => {
    /* Транспорт отказывает по причинам, которые сами не проходят.
       Повтор при каждом обращении превратился бы в бесконечный круг
       и подвесил бы экран. */
    const failing = new FakeSessionTransport()
    let attempts = 0

    failing.initError = 'Не задан идентификатор проекта'

    const original = failing.init.bind(failing)

    failing.init = () => {
      attempts += 1

      return original()
    }

    const withFailure = new DappSessionService({
      transport: failing,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await withFailure.init()
    await withFailure.init()
    await withFailure.init()

    expect(attempts).toBe(1)
  })

  it('отказ транспорта не роняет раздел, а объясняется', async () => {
    /* Раздел обязан открыться и сказать, почему не работает,
       а не остаться пустым экраном. */
    const failing = new FakeSessionTransport()

    failing.initError = 'Не задан идентификатор проекта'

    const withFailure = new DappSessionService({
      transport: failing,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await withFailure.init()

    expect(withFailure.getSnapshot().isReady).toBe(false)
    expect(withFailure.getSnapshot().error).toContain('идентификатор проекта')
  })
})

describe('Подключение приложения', () => {
  it('показывает предложение пользователю', () => {
    transport.emitProposal('p1', [ETHEREUM])

    expect(service.getSnapshot().proposal?.id).toBe('p1')
  })

  it('одобрение выдаёт адреса кошелька', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(true)

    expect(transport.lastApprovedAddresses()).toEqual([OWNER])
  })

  it('отказ отправляется приложению явно', async () => {
    /* Приложение, не получившее ответа, висит в ожидании
       и подталкивает нажать ещё раз. */
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(false)

    expect(transport.proposalAnswers.at(-1)?.[1]).toBeNull()
  })

  it('не выдаёт сети, которых нет в кошельке', async () => {
    /* Согласиться на неизвестную сеть значило бы пообещать подпись
       там, где кошелёк не может ни оценить комиссию, ни показать
       баланс. */
    transport.emitProposal('p1', [UNKNOWN_CHAIN])
    await service.respondToProposal(true)

    const approval = transport.proposalAnswers.at(-1)?.[1] as { chainIds: ChainId[] }

    expect(approval.chainIds).not.toContain(UNKNOWN_CHAIN)
  })

  it('оставляет только известные сети из запрошенных', async () => {
    transport.emitProposal('p1', [ETHEREUM, UNKNOWN_CHAIN])
    await service.respondToProposal(true)

    const approval = transport.proposalAnswers.at(-1)?.[1] as { chainIds: ChainId[] }

    expect(approval.chainIds).toEqual([ETHEREUM])
  })

  it('предложение исчезает после ответа', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.respondToProposal(true)

    expect(service.getSnapshot().proposal).toBeNull()
  })
})

describe('Запрос на подпись', () => {
  it('показывает запрос вместе с разбором рисков', () => {
    transport.emitRequest(messageRequest(OWNER))

    expect(service.getSnapshot().request?.request.id).toBe('req-1')
    expect(service.getSnapshot().request?.risks).toBeDefined()
  })

  it('сообщает о расхождении сети в разборе', () => {
    transport.emitRequest(messageRequest(OWNER, 'req-1', POLYGON))

    expect(service.getSnapshot().request?.risks.map((item) => item.risk)).toContain(
      'chain-mismatch',
    )
  })

  it('отклоняет запрос от чужого адреса без вопроса пользователю', async () => {
    /* Подписать чужим адресом всё равно нечем, а лишний экран приучает
       нажимать «подтвердить», не читая. */
    transport.emitRequest(messageRequest(STRANGER))

    await vi.waitFor(() => {
      expect(transport.responses).toHaveLength(1)
    })

    expect(transport.responses[0]?.response.kind).toBe('rejected')
    expect(service.getSnapshot().request).toBeNull()
  })

  it('отклоняет второй запрос, пока не отвечен первый', async () => {
    /* Второй экран поверх первого — способ подписать не то. */
    transport.emitRequest(messageRequest(OWNER, 'req-1'))
    transport.emitRequest(messageRequest(OWNER, 'req-2'))

    await vi.waitFor(() => {
      expect(transport.responses).toHaveLength(1)
    })

    expect(transport.responses[0]?.requestId).toBe('req-2')
    expect(service.getSnapshot().request?.request.id).toBe('req-1')
  })

  it('одобрение выполняет запрос и отправляет результат', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(transport.responses.at(-1)?.response).toEqual({
      kind: 'approved',
      result: '0xsignature',
    })
  })

  it('отказ не выполняет запрос', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(false)

    expect(execute).not.toHaveBeenCalled()
    expect(transport.responses.at(-1)?.response.kind).toBe('rejected')
  })

  it('сбой выполнения превращается в отказ, а не в молчание', async () => {
    /* Иначе приложение ждёт ответа и подталкивает пользователя
       нажать ещё раз — то есть подписать второй раз. */
    execute.mockRejectedValueOnce(new Error('Узел не ответил'))

    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    const response = transport.responses.at(-1)?.response

    expect(response?.kind).toBe('rejected')
    expect(response?.kind === 'rejected' ? response.reason : '').toContain('Узел не ответил')
  })

  it('запрос исчезает после ответа', async () => {
    transport.emitRequest(messageRequest(OWNER))
    await service.respondToRequest(true)

    expect(service.getSnapshot().request).toBeNull()
  })
})

describe('Отключение сессий', () => {
  it('разрывает подключение и обновляет список', async () => {
    transport.emitConnected({
      id: 'session-1',
      dapp: { name: 'Пример', url: 'https://example.com', description: null, iconUrl: null },
      chainIds: [ETHEREUM],
      addresses: [OWNER],
      connectedAt: 0,
      expiresAt: null,
    })

    expect(service.getSnapshot().sessions).toHaveLength(1)

    await service.disconnect('session-1')

    expect(transport.disconnected).toEqual(['session-1'])
    expect(service.getSnapshot().sessions).toHaveLength(0)
  })

  it('закрытие сбрасывает состояние', async () => {
    transport.emitProposal('p1', [ETHEREUM])
    await service.destroy()

    expect(service.getSnapshot().proposal).toBeNull()
    expect(service.getSnapshot().isReady).toBe(false)
  })
})

describe('Уведомление приложений о смене состояния', () => {
  it('передаёт транспорту текущие сеть и адреса', async () => {
    /* Приложение помнит сеть с момента подключения; без уведомления
       оно готовит операцию для прежней. */
    await service.notifyWalletState()

    expect(transport.stateChanges).toEqual([{ chainId: ETHEREUM, addresses: [OWNER] }])
  })

  it('до готовности транспорта молчит', async () => {
    /* Уведомлять некому и нечем: сервис не прошёл init(). */
    const idleTransport = new FakeSessionTransport()
    const notReady = new DappSessionService({
      transport: idleTransport,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => ETHEREUM,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await notReady.notifyWalletState()

    expect(idleTransport.stateChanges).toEqual([])
  })

  it('без активной сети не уведомляет', async () => {
    /* Между блокировкой и открытием сети нет; событие бессмысленно. */
    const noChain = new DappSessionService({
      transport,
      logger: new NullLogger(),
      getAddresses: () => [OWNER],
      getActiveChainId: () => null,
      getAvailableChainIds: () => [ETHEREUM],
      execute,
    })

    await noChain.init()
    transport.stateChanges.length = 0

    await noChain.notifyWalletState()

    expect(transport.stateChanges).toEqual([])
  })
})
