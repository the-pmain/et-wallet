import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BuiltInNetworkImmutableError,
  ChainIdMismatchError,
  InsecureRpcUrlError,
  NetworkAlreadyExistsError,
  NetworkImpersonationError,
  NetworkNotFoundError,
  NotInitializedError,
} from '@/core/errors'
import { toChainId, type ChainId } from '@/core/types'
import { FakeProviderFactory, InMemoryStorageService, NullLogger } from '@/test/doubles'

import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, DEFAULT_CHAIN_ID } from './built-in'
import { NetworkRepository } from './NetworkRepository'
import { NetworkService } from './NetworkService'
import type { IAddNetworkParams, INetworkConfig } from './types'

const CUSTOM_CHAIN_ID: ChainId = toChainId(31337)

function customNetworkParams(overrides: Partial<IAddNetworkParams> = {}): IAddNetworkParams {
  return {
    chainId: CUSTOM_CHAIN_ID,
    name: 'Local Node',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://node.example.com'],
    blockExplorerUrls: ['https://explorer.example.com'],
    ...overrides,
  }
}

interface ITestContext {
  readonly storage: InMemoryStorageService
  readonly repository: NetworkRepository
  readonly providerFactory: FakeProviderFactory
  readonly logger: NullLogger
  readonly service: NetworkService
}

function createContext(storage = new InMemoryStorageService()): ITestContext {
  const repository = new NetworkRepository(storage)
  const providerFactory = new FakeProviderFactory()
  const logger = new NullLogger()

  return {
    storage,
    repository,
    providerFactory,
    logger,
    service: new NetworkService({
      repository,
      providerFactory,
      logger,
      builtInNetworks: BUILT_IN_NETWORKS,
      defaultChainId: DEFAULT_CHAIN_ID,
    }),
  }
}

describe('NetworkService: инициализация', () => {
  let context: ITestContext

  beforeEach(() => {
    context = createContext()
  })

  it('до init() отказывает в доступе к активной сети', () => {
    expect(() => context.service.getActive()).toThrow(NotInitializedError)
  })

  it('загружает встроенные сети', async () => {
    await context.service.init()

    expect(context.service.list()).toHaveLength(BUILT_IN_NETWORKS.length)
  })

  it('выбирает сеть по умолчанию при первом запуске', async () => {
    await context.service.init()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })

  it('идемпотентен при повторном вызове', async () => {
    await context.service.init()
    await context.service.init()

    expect(context.service.list()).toHaveLength(BUILT_IN_NETWORKS.length)
  })

  it('восстанавливает сохранённый выбор активной сети', async () => {
    await context.service.init()
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Polygon)

    const restored = createContext(context.storage)
    await restored.service.init()

    expect(restored.service.getActive().chainId).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('игнорирует сохранённый выбор несуществующей сети', async () => {
    await context.repository.setActiveChainId(toChainId(999999))
    await context.service.init()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: защита встроенных сетей от подмены', () => {
  it('игнорирует сохранённую копию встроенной сети', async () => {
    const storage = new InMemoryStorageService()
    const repository = new NetworkRepository(storage)

    /* Имитация подмены: в хранилище лежит Ethereum с чужим RPC. */
    const tampered: INetworkConfig = {
      chainId: BUILT_IN_CHAIN_ID.Ethereum,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://attacker.example.com'],
      blockExplorerUrls: ['https://etherscan.io'],
      isTestnet: false,
      isBuiltIn: true,
      supportsEip1559: true,
    }
    await repository.save(tampered)

    const context = createContext(storage)
    await context.service.init()

    const ethereum = context.service.getByChainId(BUILT_IN_CHAIN_ID.Ethereum)

    expect(ethereum?.rpcUrls).not.toContain('https://attacker.example.com')
  })

  it('сообщает в журнал об отброшенной записи', async () => {
    const storage = new InMemoryStorageService()
    const repository = new NetworkRepository(storage)
    const [ethereum] = BUILT_IN_NETWORKS

    await repository.save(ethereum as INetworkConfig)

    const context = createContext(storage)
    await context.service.init()

    const warnings = context.logger.records.filter((record) => record.level === 'warn')

    expect(warnings).toHaveLength(1)
  })
})

describe('NetworkService: переключение сетей', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = createContext()
    await context.service.init()
  })

  it('меняет активную сеть', async () => {
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Arbitrum)

    expect(context.service.getActive().chainId).toBe(BUILT_IN_CHAIN_ID.Arbitrum)
  })

  it('порождает событие network:changed', async () => {
    const listener = vi.fn()
    context.service.on('network:changed', listener)

    await context.service.switchTo(BUILT_IN_CHAIN_ID.Base)

    expect(listener).toHaveBeenCalledExactlyOnceWith({ chainId: BUILT_IN_CHAIN_ID.Base })
  })

  it('не порождает событие при переключении на уже активную сеть', async () => {
    const listener = vi.fn()
    context.service.on('network:changed', listener)

    await context.service.switchTo(DEFAULT_CHAIN_ID)

    expect(listener).not.toHaveBeenCalled()
  })

  it('сохраняет выбор в хранилище', async () => {
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Optimism)

    await expect(context.repository.getActiveChainId()).resolves.toBe(BUILT_IN_CHAIN_ID.Optimism)
  })

  it('отказывает в переключении на незарегистрированную сеть', async () => {
    await expect(context.service.switchTo(toChainId(999999))).rejects.toThrow(NetworkNotFoundError)
  })

  it('не меняет активную сеть при отказе', async () => {
    await expect(context.service.switchTo(toChainId(999999))).rejects.toThrow()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: добавление сети', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = createContext()
    await context.service.init()
  })

  it('добавляет пользовательскую сеть', async () => {
    const added = await context.service.add(customNetworkParams())

    expect(added.chainId).toBe(CUSTOM_CHAIN_ID)
    expect(added.isBuiltIn).toBe(false)
    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).not.toBeNull()
  })

  it('сохраняет сеть в хранилище', async () => {
    await context.service.add(customNetworkParams())

    const restored = createContext(context.storage)
    await restored.service.init()

    expect(restored.service.getByChainId(CUSTOM_CHAIN_ID)?.name).toBe('Local Node')
  })

  it('порождает событие network:listChanged', async () => {
    const listener = vi.fn()
    context.service.on('network:listChanged', listener)

    await context.service.add(customNetworkParams())

    expect(listener).toHaveBeenCalledOnce()
  })

  it('отвергает сеть с уже существующим идентификатором', async () => {
    await expect(
      context.service.add(customNetworkParams({ chainId: BUILT_IN_CHAIN_ID.Ethereum })),
    ).rejects.toThrow(NetworkAlreadyExistsError)
  })

  it('отвергает сеть, носящую имя встроенной', async () => {
    /* Сверка chainId с узлом этого не поймает: узел честно подтвердит
       свой идентификатор. Совпадение имени — единственный признак. */
    await expect(context.service.add(customNetworkParams({ name: 'Ethereum' }))).rejects.toThrow(
      NetworkImpersonationError,
    )
  })

  it('не обращается к узлу, обнаружив подмену имени', async () => {
    const before = context.providerFactory.createdCount

    await expect(
      context.service.add(customNetworkParams({ name: 'Ethereum' })),
    ).rejects.toBeInstanceOf(NetworkImpersonationError)

    /* Проверка имени бесплатна и выполняется первой: незачем ждать
       ответа узла, чтобы отвергнуть заведомо опасную конфигурацию. */
    expect(context.providerFactory.createdCount).toBe(before)
  })

  it('называет сеть, за которую выдаёт себя добавляемая', async () => {
    try {
      await context.service.add(customNetworkParams({ name: 'Polygon' }))
      expect.unreachable('добавление должно было завершиться отказом')
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkImpersonationError)
      expect((error as NetworkImpersonationError).impersonatedChainId).toBe(
        BUILT_IN_CHAIN_ID.Polygon,
      )
    }
  })

  it('добавляет одноимённую сеть по явному согласию', async () => {
    const added = await context.service.add(
      customNetworkParams({ name: 'Ethereum', allowImpersonation: true }),
    )

    /* Согласие обязано быть отдельным действием, но запрещать операцию
       совсем нельзя: у пользователя может быть законная причина. */
    expect(added.name).toBe('Ethereum')
    expect(added.chainId).toBe(CUSTOM_CHAIN_ID)
  })

  it('не считает подменой сеть с уникальным именем', async () => {
    await expect(
      context.service.add(customNetworkParams({ name: 'My Private Chain' })),
    ).resolves.toBeDefined()
  })

  it('отвергает незащищённый RPC-адрес', async () => {
    await expect(
      context.service.add(customNetworkParams({ rpcUrls: ['http://node.example.com'] })),
    ).rejects.toThrow(InsecureRpcUrlError)
  })

  it('отвергает незащищённый адрес обозревателя', async () => {
    await expect(
      context.service.add(
        customNetworkParams({ blockExplorerUrls: ['http://explorer.example.com'] }),
      ),
    ).rejects.toThrow(InsecureRpcUrlError)
  })

  it('не обращается к узлу, если адреса не прошли проверку', async () => {
    await expect(
      context.service.add(customNetworkParams({ rpcUrls: ['http://node.example.com'] })),
    ).rejects.toThrow()

    expect(context.providerFactory.createdCount).toBe(0)
  })

  it('отвергает сеть, если узел сообщает чужой chainId', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow(ChainIdMismatchError)
  })

  it('не сохраняет сеть при несовпадении chainId', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow()

    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).toBeNull()
    await expect(context.repository.findByChainId(CUSTOM_CHAIN_ID)).resolves.toBeNull()
  })

  it('закрывает соединение после проверки', async () => {
    await context.service.add(customNetworkParams())

    expect(context.providerFactory.lastProvider?.isActive).toBe(false)
  })

  it('закрывает соединение даже при несовпадении chainId', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow()

    expect(context.providerFactory.lastProvider?.isActive).toBe(false)
  })
})

describe('NetworkService: удаление сети', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = createContext()
    await context.service.init()
    await context.service.add(customNetworkParams())
  })

  it('удаляет пользовательскую сеть', async () => {
    await context.service.remove(CUSTOM_CHAIN_ID)

    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).toBeNull()
  })

  it('удаляет запись из хранилища', async () => {
    await context.service.remove(CUSTOM_CHAIN_ID)

    await expect(context.repository.findByChainId(CUSTOM_CHAIN_ID)).resolves.toBeNull()
  })

  it('отказывает в удалении встроенной сети', async () => {
    await expect(context.service.remove(BUILT_IN_CHAIN_ID.Ethereum)).rejects.toThrow(
      BuiltInNetworkImmutableError,
    )
  })

  it('отказывает в удалении незарегистрированной сети', async () => {
    await expect(context.service.remove(toChainId(999999))).rejects.toThrow(NetworkNotFoundError)
  })

  it('переключается на сеть по умолчанию при удалении активной', async () => {
    await context.service.switchTo(CUSTOM_CHAIN_ID)
    await context.service.remove(CUSTOM_CHAIN_ID)

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: изменение сети', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = createContext()
    await context.service.init()
    await context.service.add(customNetworkParams())
  })

  it('меняет имя пользовательской сети', async () => {
    const updated = await context.service.update(CUSTOM_CHAIN_ID, { name: 'Новое имя' })

    expect(updated.name).toBe('Новое имя')
  })

  it('не меняет идентификатор сети', async () => {
    const updated = await context.service.update(CUSTOM_CHAIN_ID, {
      chainId: toChainId(777),
      name: 'Подмена',
    })

    expect(updated.chainId).toBe(CUSTOM_CHAIN_ID)
    expect(context.service.getByChainId(toChainId(777))).toBeNull()
  })

  it('отказывает в изменении встроенной сети', async () => {
    await expect(
      context.service.update(BUILT_IN_CHAIN_ID.Ethereum, { name: 'Поддельный Ethereum' }),
    ).rejects.toThrow(BuiltInNetworkImmutableError)
  })

  it('отвергает незащищённый RPC-адрес', async () => {
    await expect(
      context.service.update(CUSTOM_CHAIN_ID, { rpcUrls: ['http://node.example.com'] }),
    ).rejects.toThrow(InsecureRpcUrlError)
  })
})
