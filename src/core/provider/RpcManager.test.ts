import { beforeEach, describe, expect, it } from 'vitest'

import { SecureStorage } from '@/core/encryption'
import { ChainIdMismatchError, InsecureRpcUrlError, ProviderUnavailableError } from '@/core/errors'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, type INetworkConfig } from '@/core/network'
import { MemoryStorageService } from '@/core/storage'
import { toChainId, type Wei } from '@/core/types'
import { FakeClock, FakeProviderFactory, FastEncryptionService, NullLogger } from '@/test/doubles'

import { AlchemyProvider } from './AlchemyProvider'
import { CustomRpcProvider } from './CustomRpcProvider'
import { PublicRpcProvider } from './PublicRpcProvider'
import { RPC_PROVIDER_ID } from './rpc-endpoint'
import { RpcManager } from './RpcManager'

const PASSWORD = 'Korova-7-Luna!'

const ETHEREUM = BUILT_IN_NETWORKS.find(
  (network) => network.chainId === BUILT_IN_CHAIN_ID.Ethereum,
) as INetworkConfig

const COOLDOWN_MS = 60_000

let factory: FakeProviderFactory
let clock: FakeClock
let custom: CustomRpcProvider
let manager: RpcManager

async function createManager(apiKey: string | null = null): Promise<RpcManager> {
  const secure = new SecureStorage(new MemoryStorageService(), new FastEncryptionService())

  await secure.initialize(PASSWORD)

  custom = new CustomRpcProvider(secure)
  await custom.init(BUILT_IN_NETWORKS)

  return new RpcManager({
    providers: [custom, new AlchemyProvider({ apiKey }), new PublicRpcProvider()],
    factory,
    clock,
    logger: new NullLogger(),
    options: { cooldownMs: COOLDOWN_MS },
  })
}

beforeEach(async () => {
  factory = new FakeProviderFactory()
  factory.configure({ balance: 1n as Wei })
  clock = new FakeClock(1_700_000_000_000)
  manager = await createManager()
})

describe('RpcManager: порядок источников', () => {
  it('без ключа и без своих адресов использует публичные узлы', () => {
    const endpoints = manager.listEndpoints(ETHEREUM)

    expect(endpoints.every((endpoint) => endpoint.providerId === RPC_PROVIDER_ID.Public)).toBe(true)
    expect(endpoints.map((endpoint) => endpoint.url)).toEqual(ETHEREUM.rpcUrls)
  })

  it('ставит Alchemy впереди публичных узлов', async () => {
    const withKey = await createManager('test-key')

    expect(withKey.listEndpoints(ETHEREUM)[0]?.providerId).toBe(RPC_PROVIDER_ID.Alchemy)
  })

  it('ставит собственный узел пользователя впереди Alchemy', async () => {
    const withKey = await createManager('test-key')

    await custom.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://my-node.example')

    /* Пользователь выбрал адрес сознательно. Подставлять вместо него
       значение по умолчанию значит отменять решение владельца средств. */
    expect(withKey.listEndpoints(ETHEREUM)[0]?.providerId).toBe(RPC_PROVIDER_ID.Custom)
  })

  it('не повторяет один адрес дважды', async () => {
    const duplicated = ETHEREUM.rpcUrls[0] as string

    await custom.add(BUILT_IN_CHAIN_ID.Ethereum, duplicated)

    const urls = manager.listEndpoints(ETHEREUM).map((endpoint) => endpoint.url)

    expect(urls.filter((url) => url === duplicated)).toHaveLength(1)
  })

  it('пропускает источник, не обслуживающий сеть', async () => {
    const withKey = await createManager('test-key')
    const unknown: INetworkConfig = { ...ETHEREUM, chainId: toChainId(999_999n) }

    expect(
      withKey.listEndpoints(unknown).every((e) => e.providerId === RPC_PROVIDER_ID.Public),
    ).toBe(true)
  })
})

describe('RpcManager: кэш соединений', () => {
  it('переиспользует соединение при повторном обращении', async () => {
    await manager.get(ETHEREUM)
    await manager.get(ETHEREUM)

    expect(factory.createdCount).toBe(1)
  })

  it('разделяет одно создание между параллельными обращениями', async () => {
    await Promise.all([manager.get(ETHEREUM), manager.get(ETHEREUM), manager.get(ETHEREUM)])

    expect(factory.createdCount).toBe(1)
  })

  it('не оставляет отклонённую попытку в кэше', async () => {
    factory.configure({ unavailable: true })

    await expect(manager.get(ETHEREUM)).rejects.toBeInstanceOf(ProviderUnavailableError)

    factory.configure({ balance: 1n as Wei })

    /* Следующий вызов обязан попробовать снова: узел мог восстановиться. */
    await expect(manager.get(ETHEREUM)).resolves.toBeDefined()
  })

  it('закрывает соединение по release', async () => {
    await manager.get(ETHEREUM)
    await manager.release(ETHEREUM.chainId)

    expect(factory.lastProvider?.isActive).toBe(false)
  })

  it('закрывает все соединения по destroy', async () => {
    await manager.get(ETHEREUM)
    await manager.destroy()

    expect(factory.lastProvider?.isActive).toBe(false)
    await expect(manager.get(ETHEREUM)).rejects.toBeInstanceOf(ProviderUnavailableError)
  })
})

describe('RpcManager: проверка доступности', () => {
  it('проверяет каждый адрес сети', async () => {
    const health = await manager.checkHealth(ETHEREUM)

    expect(health).toHaveLength(ETHEREUM.rpcUrls.length)
    expect(health.every((item) => item.isHealthy)).toBe(true)
  })

  it('измеряет время ответа', async () => {
    const health = await manager.checkHealth(ETHEREUM)

    expect(health[0]?.latencyMs).not.toBeNull()
  })

  it('сообщает причину отказа, а не молчит', async () => {
    factory.configure({ unavailable: true })

    const health = await manager.checkHealth(ETHEREUM)

    expect(health.every((item) => !item.isHealthy)).toBe(true)
    expect(health[0]?.reason).not.toBeNull()
    expect(health[0]?.latencyMs).toBeNull()
  })

  it('отделяет чужую сеть от недоступности', async () => {
    factory.configure({ reportedChainId: toChainId(137n), verifyChainIdOnCreate: true })

    const health = await manager.checkHealth(ETHEREUM)

    /* Недоступный узел — неудобство. Узел с чужим chainId — ошибка
       настройки либо попытка подмены, и это требует внимания. */
    expect(health[0]?.isChainMismatch).toBe(true)
  })

  it('закрывает диагностические соединения', async () => {
    await manager.checkHealth(ETHEREUM)

    expect(factory.lastProvider?.isActive).toBe(false)
  })
})

describe('RpcManager: выдержка после отказа', () => {
  it('исключает отказавший адрес из ближайших попыток', async () => {
    factory.configure({ unavailable: true })
    await manager.checkHealth(ETHEREUM)

    factory.configure({ balance: 1n as Wei })

    /* Все адреса отбывают выдержку, поэтому список не пуст: отказать
       в подключении, имея непроверенные адреса, хуже, чем попробовать. */
    await expect(manager.get(ETHEREUM)).resolves.toBeDefined()
  })

  it('возвращает адрес в перебор по истечении выдержки', async () => {
    factory.configure({ unavailable: true })
    await manager.checkHealth(ETHEREUM)

    clock.advance(COOLDOWN_MS + 1)
    factory.configure({ balance: 1n as Wei })

    const health = await manager.checkHealth(ETHEREUM)

    expect(health.every((item) => item.isHealthy)).toBe(true)
  })
})

describe('RpcManager: пользовательский адрес', () => {
  it('сохраняет адрес после проверки узла', async () => {
    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')

    expect(custom.listUrls(ETHEREUM.chainId)).toEqual(['https://my-node.example'])
  })

  it('не сохраняет адрес узла, обслуживающего другую сеть', async () => {
    factory.configure({ reportedChainId: toChainId(137n), verifyChainIdOnCreate: true })

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'https://wrong-chain.example'),
    ).rejects.toBeInstanceOf(ChainIdMismatchError)

    /* Иначе адрес чужой сети применялся бы при каждом запуске: подписи,
       сделанные для другой цепи, пригодны для повторного проигрывания. */
    expect(custom.listUrls(ETHEREUM.chainId)).toHaveLength(0)
  })

  it('не сохраняет недоступный адрес', async () => {
    factory.configure({ unavailable: true })

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'https://offline.example'),
    ).rejects.toBeInstanceOf(ProviderUnavailableError)

    expect(custom.listUrls(ETHEREUM.chainId)).toHaveLength(0)
  })

  it('отвергает открытый HTTP до обращения к сети', async () => {
    const before = factory.createdCount

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'http://insecure.example'),
    ).rejects.toBeInstanceOf(InsecureRpcUrlError)

    expect(factory.createdCount).toBe(before)
  })

  it('пересоздаёт соединение после добавления адреса', async () => {
    await manager.get(ETHEREUM)

    const before = factory.lastProvider

    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')

    /* Иначе выбор пользователя не применялся бы до перезапуска. */
    expect(before?.isActive).toBe(false)
  })

  it('удаляет адрес и возвращается к прежним источникам', async () => {
    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')
    await manager.removeCustomEndpoint(ETHEREUM, 'https://my-node.example')

    expect(manager.listEndpoints(ETHEREUM).map((endpoint) => endpoint.url)).toEqual(
      ETHEREUM.rpcUrls,
    )
  })
})
