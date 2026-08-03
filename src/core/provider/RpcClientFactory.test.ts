import { beforeEach, describe, expect, it } from 'vitest'

import { ChainIdMismatchError, ProviderUnavailableError } from '@/core/errors'
import { BUILT_IN_CHAIN_ID, type INetworkConfig } from '@/core/network'
import { toChainId, type ChainId } from '@/core/types'
import { FakeJsonRpcNode, NullLogger } from '@/test/doubles'

import type { IProvider } from './contracts'
import { RpcClient } from './RpcClient'
import { RpcClientFactory } from './RpcClientFactory'

const CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum

/**
 * Фабрика с подменённым подключением.
 *
 * Правила перебора проверяются без обращения к сети: реальные запросы
 * сделали бы набор медленным и недетерминированным, а проверяется здесь
 * логика выбора узла, а не транспорт. Сам транспорт покрыт отдельно
 * в `RpcClient.test.ts`.
 */
class TestableFactory extends RpcClientFactory {
  /** Поведение каждого адреса: узел либо ошибка. */
  readonly nodes = new Map<string, FakeJsonRpcNode | Error>()

  /** Адреса в порядке фактических попыток подключения. */
  readonly attempts: string[] = []

  protected override async connect(rpcUrl: string, chainId: ChainId): Promise<IProvider> {
    this.attempts.push(rpcUrl)

    const entry = this.nodes.get(rpcUrl)

    if (entry === undefined || entry instanceof Error) {
      throw entry ?? new Error(`узел ${rpcUrl} недоступен`)
    }

    return await RpcClient.attach(entry, chainId, rpcUrl)
  }
}

function network(rpcUrls: readonly string[]): INetworkConfig {
  return {
    chainId: CHAIN_ID,
    name: 'Test network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls,
    blockExplorerUrls: [],
    isTestnet: false,
    isBuiltIn: false,
    supportsEip1559: true,
  }
}

let logger: NullLogger
let factory: TestableFactory

beforeEach(() => {
  logger = new NullLogger()
  factory = new TestableFactory({ logger })
})

describe('RpcClientFactory: выбор узла', () => {
  it('подключается к первому доступному адресу', async () => {
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(network(['https://a.example.com']))

    try {
      expect(provider.rpcUrl).toBe('https://a.example.com')
      expect(provider.isActive).toBe(true)
    } finally {
      provider.destroy()
    }
  })

  it('соблюдает порядок приоритета', async () => {
    factory.nodes.set('https://first.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))
    factory.nodes.set('https://second.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://first.example.com', 'https://second.example.com']),
    )

    try {
      /* Список задан в порядке приоритета: первым обычно стоит наиболее
         надёжный оператор, поэтому перемешивать перебор нельзя. */
      expect(provider.rpcUrl).toBe('https://first.example.com')
      expect(factory.attempts).toEqual(['https://first.example.com'])
    } finally {
      provider.destroy()
    }
  })

  it('переходит к резервному адресу при отказе основного', async () => {
    factory.nodes.set('https://down.example.com', new Error('соединение отклонено'))
    factory.nodes.set('https://backup.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://down.example.com', 'https://backup.example.com']),
    )

    try {
      expect(provider.rpcUrl).toBe('https://backup.example.com')
      expect(factory.attempts).toHaveLength(2)
    } finally {
      provider.destroy()
    }
  })

  it('пропускает узел, обслуживающий другую сеть', async () => {
    /* Узел с чужим chainId исключается из перебора, но не приводит
       к отказу целиком: резервный адрес может быть исправен. */
    factory.nodes.set('https://wrong-chain.example.com', new FakeJsonRpcNode(137))
    factory.nodes.set('https://correct.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(
      network(['https://wrong-chain.example.com', 'https://correct.example.com']),
    )

    try {
      expect(provider.rpcUrl).toBe('https://correct.example.com')
    } finally {
      provider.destroy()
    }
  })
})

describe('RpcClientFactory: отказ', () => {
  it('отказывает при пустом списке адресов', async () => {
    await expect(factory.create(network([]))).rejects.toThrow(ProviderUnavailableError)
  })

  it('отказывает, когда ни один узел не доступен', async () => {
    factory.nodes.set('https://a.example.com', new Error('таймаут'))
    factory.nodes.set('https://b.example.com', new Error('таймаут'))

    await expect(
      factory.create(network(['https://a.example.com', 'https://b.example.com'])),
    ).rejects.toThrow(ProviderUnavailableError)

    expect(factory.attempts).toHaveLength(2)
  })

  it('сохраняет причину последней попытки', async () => {
    factory.nodes.set('https://wrong-chain.example.com', new FakeJsonRpcNode(137))

    /* При единственном узле с чужим chainId пользователь должен увидеть
       именно эту причину, а не обобщённое «сеть недоступна». */
    await expect(
      factory.create(network(['https://wrong-chain.example.com'])),
    ).rejects.toMatchObject({ cause: expect.any(ChainIdMismatchError) as unknown })
  })
})

describe('RpcClientFactory: журнал', () => {
  it('записывает предупреждение о недоступном узле', async () => {
    factory.nodes.set('https://a.example.com', new Error('таймаут'))

    await expect(factory.create(network(['https://a.example.com']))).rejects.toThrow()

    const warnings = logger.records.filter((record) => record.level === 'warn')

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.context?.['rpcUrl']).toBe('https://a.example.com')
  })

  it('отдельно отмечает узел с чужим chainId', async () => {
    /* Это либо ошибка конфигурации, либо попытка подмены — оба случая
       заслуживают внимания и не должны теряться среди отказов сети. */
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(137))

    await expect(factory.create(network(['https://a.example.com']))).rejects.toThrow()

    const warning = logger.records.find((record) => record.context?.['actual'] !== undefined)

    expect(warning?.context?.['expected']).toBe('1')
    expect(warning?.context?.['actual']).toBe('137')
  })

  it('не пишет предупреждений при успешном подключении', async () => {
    factory.nodes.set('https://a.example.com', new FakeJsonRpcNode(Number(CHAIN_ID)))

    const provider = await factory.create(network(['https://a.example.com']))

    try {
      expect(logger.records.filter((record) => record.level === 'warn')).toHaveLength(0)
    } finally {
      provider.destroy()
    }
  })

  it('работает с нестандартным идентификатором сети', async () => {
    const custom = toChainId(31337)
    factory.nodes.set('https://local.example.com', new FakeJsonRpcNode(Number(custom)))

    const provider = await factory.create({
      ...network(['https://local.example.com']),
      chainId: custom,
    })

    try {
      expect(provider.chainId).toBe(custom)
    } finally {
      provider.destroy()
    }
  })
})
