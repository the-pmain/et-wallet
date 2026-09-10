import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EventBus } from '@/core/events'
import { InsufficientFundsError, ProviderUnavailableError, RpcError } from '@/core/errors'
import { toAddress } from '@/core/address'
import { toChainId, type ChainId, type HexString, type TxHash, type Wei } from '@/core/types'
import { NullLogger } from '@/test/doubles'

import type { IProvider } from './contracts'
import { FailoverProvider } from './FailoverProvider'
import { RPC_PROVIDER_ID, type IRpcEndpoint } from './rpc-endpoint'
import type { ProviderEventMap } from './types'

const CHAIN_ID = toChainId(1n)
const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

function endpoint(url: string): IRpcEndpoint {
  return { url, providerId: RPC_PROVIDER_ID.Public, providerName: 'Тест' }
}

const ENDPOINTS = [
  endpoint('https://a.example'),
  endpoint('https://b.example'),
  endpoint('https://c.example'),
]

/** Поведение узла-дублёра в конкретном тесте. */
interface INodeBehaviour {
  /** Отказ при подключении. */
  readonly failOnConnect?: boolean
  /** Отказ транспорта при каждом вызове. */
  readonly failTransport?: boolean

  /** Узел не умеет `eth_simulateV1`, оставаясь исправным в остальном. */
  readonly failSimulate?: boolean
  /** Ответ узла с ошибкой JSON-RPC. */
  readonly rpcError?: boolean

  /**
   * Отказ ТОЛЬКО на выборке журналов при исправном узле в остальном.
   *
   * Именно так ведут себя публичные узлы: измерено живьём — «408» и
   * «403» на `eth_getLogs` у двух узлов, отдававших баланс в ту же
   * секунду.
   */
  readonly failLogs?: boolean

  readonly balance?: bigint
  readonly logs?: readonly never[]
}

class StubProvider implements IProvider {
  readonly chainId = CHAIN_ID
  readonly rpcUrl: string
  isActive = true

  balanceCalls = 0
  sendCalls = 0
  logCalls = 0
  simulateCalls = 0

  readonly #behaviour: INodeBehaviour
  readonly #events = new EventBus<ProviderEventMap>()

  constructor(url: string, behaviour: INodeBehaviour) {
    this.rpcUrl = url
    this.#behaviour = behaviour
  }

  #fail(): never {
    if (this.#behaviour.rpcError === true) {
      throw new InsufficientFundsError(0n, 0n)
    }

    throw new ProviderUnavailableError(CHAIN_ID)
  }

  request<TResult>(request: { method: string }): Promise<TResult> {
    if (request.method !== 'eth_simulateV1') {
      return Promise.reject(new Error('не поддержано'))
    }

    this.simulateCalls += 1

    return this.#behaviour.failSimulate === true
      ? Promise.reject(new RpcError(-32601, 'the method does not exist'))
      : Promise.resolve('симуляция' as TResult)
  }

  getChainId(): Promise<ChainId> {
    return Promise.resolve(CHAIN_ID)
  }

  getBlockNumber(): Promise<bigint> {
    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve(1n)
  }

  getBalance(): Promise<Wei> {
    this.balanceCalls += 1

    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve((this.#behaviour.balance ?? 0n) as Wei)
  }

  getTransactionCount(): Promise<number> {
    return Promise.resolve(0)
  }

  getNonce(): Promise<number> {
    return Promise.resolve(0)
  }

  call(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }

  /** Байт-код по адресу. Обычный адрес: проверок контракта в этих тестах нет. */
  getCode(): Promise<HexString> {
    return Promise.resolve('0x' as HexString)
  }
  estimateGas(): Promise<bigint> {
    return Promise.resolve(21_000n)
  }

  getFeeData(): Promise<never> {
    return Promise.reject(new Error('не поддержано'))
  }

  sendRawTransaction(): Promise<TxHash> {
    this.sendCalls += 1

    if (this.#behaviour.failTransport === true) {
      return Promise.reject(new ProviderUnavailableError(CHAIN_ID))
    }

    return Promise.resolve('0xhash' as TxHash)
  }

  getTransactionReceipt(): Promise<null> {
    return Promise.resolve(null)
  }

  getLogs(): Promise<readonly never[]> {
    this.logCalls += 1

    if (this.#behaviour.failLogs === true) {
      return Promise.reject(new RpcError(-32602, 'archive requests require a token'))
    }

    if (this.#behaviour.failTransport === true || this.#behaviour.rpcError === true) {
      return Promise.reject(this.#error())
    }

    return Promise.resolve(this.#behaviour.logs ?? [])
  }

  destroy(): void {
    this.isActive = false
  }

  #error(): Error {
    try {
      this.#fail()
    } catch (error) {
      return error as Error
    }
  }

  on = this.#events.on.bind(this.#events)
  once = this.#events.once.bind(this.#events)
  off = this.#events.off.bind(this.#events)
}

let behaviours: Map<string, INodeBehaviour>
let created: StubProvider[]

function createProvider(endpoints = ENDPOINTS, onSwitch: () => void = () => undefined) {
  return new FailoverProvider({
    chainId: CHAIN_ID,
    endpoints,
    logger: new NullLogger(),
    onSwitch,
    connect: (target) => {
      const behaviour = behaviours.get(target.url) ?? {}

      if (behaviour.failOnConnect === true) {
        return Promise.reject(new ProviderUnavailableError(CHAIN_ID))
      }

      const stub = new StubProvider(target.url, behaviour)
      created.push(stub)

      return Promise.resolve(stub)
    },
  })
}

beforeEach(() => {
  behaviours = new Map()
  created = []
})

describe('FailoverProvider: подключение', () => {
  it('использует первый адрес списка', async () => {
    behaviours.set('https://a.example', { balance: 5n })

    const provider = createProvider()

    expect(await provider.getBalance(OWNER)).toBe(5n)
    expect(provider.rpcUrl).toBe('https://a.example')
  })

  it('переходит к следующему адресу, если первый не подключается', async () => {
    behaviours.set('https://a.example', { failOnConnect: true })
    behaviours.set('https://b.example', { balance: 7n })

    const provider = createProvider()

    expect(await provider.getBalance(OWNER)).toBe(7n)
    expect(provider.rpcUrl).toBe('https://b.example')
  })

  it('отказывает, когда не подключается ни один адрес', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failOnConnect: true })
    }

    await expect(createProvider().getBalance(OWNER)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('разделяет одно подключение между параллельными вызовами', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()

    await Promise.all([provider.getBalance(OWNER), provider.getBalance(OWNER)])

    expect(created).toHaveLength(1)
  })

  it('сообщает действующий адрес с указанием источника', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()
    await provider.getBalance(OWNER)

    expect(provider.activeEndpoint?.url).toBe('https://a.example')
    expect(provider.activeEndpoint?.providerId).toBe(RPC_PROVIDER_ID.Public)
  })
})

describe('FailoverProvider: отказ узла посреди работы', () => {
  it('переключается на резервный адрес и возвращает результат', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 42n })

    const provider = createProvider()

    /* Ровно то, чего не умел прежний перебор: узел, отказавший после
       подключения, обрекал все вызовы до конца сессии. */
    expect(await provider.getBalance(OWNER)).toBe(42n)
    expect(provider.rpcUrl).toBe('https://b.example')
  })

  it('закрывает соединение с отказавшим узлом', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    await createProvider().getBalance(OWNER)

    expect(created[0]?.isActive).toBe(false)
  })

  it('не возвращается к отказавшему адресу при следующем вызове', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    const provider = createProvider()

    await provider.getBalance(OWNER)
    await provider.getBalance(OWNER)

    /* Повтор на уже отказавшем адресе только удлинил бы ожидание. */
    expect(created.filter((stub) => stub.rpcUrl === 'https://a.example')).toHaveLength(1)
  })

  it('уведомляет о смене узла', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', { balance: 1n })

    const onSwitch = vi.fn()

    await createProvider(ENDPOINTS, onSwitch).getBalance(OWNER)

    expect(onSwitch).toHaveBeenCalledTimes(1)
  })

  it('отказывает, когда резервных адресов не осталось', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failTransport: true })
    }

    await expect(createProvider().getBalance(OWNER)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
  })

  it('признаёт себя непригодным, исчерпав список', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failTransport: true })
    }

    const provider = createProvider()

    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(ProviderUnavailableError)

    /* Иначе `RpcManager` оставил бы пустышку в кэше, и кошелёк сообщал
       бы о недоступной сети при исправных узлах до перезагрузки. */
    expect(provider.isActive).toBe(false)
  })
})

/**
 * Отказ на журналах — приговор запросу, а не узлу.
 *
 * Поведение проверено на живых узлах: `eth.drpc.org` отвечал «408», а
 * `ethereum-rpc.publicnode.com` — «403: нужен архивный токен», причём
 * оба в ту же секунду отдавали баланс. Обычный перебор вычёркивал бы
 * по узлу за каждый заход в историю и оставил бы кошелёк без соединения.
 */
describe('FailoverProvider: выборка журналов', () => {
  const ANY_FILTER = { fromBlock: 0n, toBlock: 1n }

  it('оставляет узел в работе, когда тот отказал только на журналах', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failLogs: true })
    }
    behaviours.set('https://a.example', { failLogs: true, balance: 3n })

    const provider = createProvider()

    await expect(provider.getLogs(ANY_FILTER)).rejects.toBeInstanceOf(RpcError)

    /* Главное в этой проверке: узел остался рабочим. Ради истории
       нельзя лишать кошелёк баланса и отправки. */
    expect(await provider.getBalance(OWNER)).toBe(3n)
    expect(provider.rpcUrl).toBe('https://a.example')
  })

  it('спрашивает симуляцию у соседа, когда действующий узел её не умеет', async () => {
    /* Живое измерение: шлюз, отдающий журналы, отказывает в симуляции,
       а узел, выполняющий симуляцию, не отдаёт журналов. Без опроса
       соседей одно из двух всегда оставалось бы недоступным. */
    behaviours.set('https://a.example', { failSimulate: true, balance: 3n })

    const provider = createProvider()

    expect(await provider.request({ method: 'eth_simulateV1', params: [] })).toBe('симуляция')

    /* Действующий узел не сменился: он исправен, просто не умеет
       именно этого вызова. */
    expect(provider.rpcUrl).toBe('https://a.example')
    expect(await provider.getBalance(OWNER)).toBe(3n)
  })

  it('берёт журналы у соседа, когда действующий узел в них отказал', async () => {
    behaviours.set('https://a.example', { failLogs: true, balance: 3n })

    const provider = createProvider()

    expect(await provider.getLogs(ANY_FILTER)).toStrictEqual([])

    /* Сосед ответил, но действующим не стал: его спросили и отпустили. */
    expect(provider.rpcUrl).toBe('https://a.example')
    expect(created.find((stub) => stub.rpcUrl === 'https://b.example')?.logCalls).toBe(1)
  })

  it('закрывает временное соединение с соседом', async () => {
    behaviours.set('https://a.example', { failLogs: true })

    await createProvider().getLogs(ANY_FILTER)

    expect(created.find((stub) => stub.rpcUrl === 'https://b.example')?.isActive).toBe(false)
  })

  it('доводит ошибку действующего узла, когда отказали все', async () => {
    for (const item of ENDPOINTS) {
      behaviours.set(item.url, { failLogs: true })
    }

    /* Наружу уходит ответ того узла, с которым кошелёк работает,
       а не случайного соседа, опрошенного последним. */
    await expect(createProvider().getLogs(ANY_FILTER)).rejects.toMatchObject({ rpcCode: -32602 })
  })
})

describe('FailoverProvider: ошибка узла не является отказом транспорта', () => {
  it('не переключается, когда узел ответил ошибкой', async () => {
    behaviours.set('https://a.example', { rpcError: true })
    behaviours.set('https://b.example', { balance: 1n })

    const provider = createProvider()

    /* Узел, который ответил, работает. Второй ответит то же самое:
       недостаток средств не зависит от того, кого спрашивать. */
    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(created).toHaveLength(1)
  })

  it('доводит исходную ошибку до вызывающего кода', async () => {
    behaviours.set('https://a.example', { rpcError: true })

    await expect(createProvider().getBalance(OWNER)).rejects.not.toBeInstanceOf(RpcError)
  })
})

describe('FailoverProvider: отправка транзакции', () => {
  it('не повторяет отправку на другом узле', async () => {
    behaviours.set('https://a.example', { failTransport: true })
    behaviours.set('https://b.example', {})

    const provider = createProvider()

    /* Судьба первой отправки неизвестна: узел мог принять транзакцию
       и не успеть ответить. Второй узел вернул бы «already known»,
       и кошелёк показал бы отказ по принятой транзакции. */
    await expect(provider.sendRawTransaction('0xsigned' as HexString)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
    expect(created).toHaveLength(1)
  })

  it('отправляет через действующий узел', async () => {
    behaviours.set('https://a.example', {})

    expect(await createProvider().sendRawTransaction('0xsigned' as HexString)).toBe('0xhash')
  })
})

describe('FailoverProvider: уничтожение', () => {
  it('закрывает действующее соединение', async () => {
    behaviours.set('https://a.example', { balance: 1n })

    const provider = createProvider()
    await provider.getBalance(OWNER)

    provider.destroy()

    expect(provider.isActive).toBe(false)
    expect(created[0]?.isActive).toBe(false)
  })

  it('отказывает в вызовах после уничтожения', async () => {
    const provider = createProvider()
    provider.destroy()

    await expect(provider.getBalance(OWNER)).rejects.toBeInstanceOf(ProviderUnavailableError)
  })
})
