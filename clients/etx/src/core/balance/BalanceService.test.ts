import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotImplementedError } from '@/core/errors'
import {
  BUILT_IN_CHAIN_ID,
  BUILT_IN_NETWORKS,
  DEFAULT_CHAIN_ID,
  NetworkRepository,
  NetworkService,
} from '@/core/network'
import { ProviderPool } from '@/core/provider'
import { toAddress } from '@/core/address'
import type { Wei } from '@/core/types'
import {
  FakeClock,
  FakeProviderFactory,
  NullLogger,
  createSecureMemoryStorage,
} from '@/test/doubles'

import { BalanceService } from './BalanceService'

const OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
const TOKEN_ADDRESS = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

const FRESHNESS_MS = 15_000

let factory: FakeProviderFactory
let clock: FakeClock
let networks: NetworkService
let service: BalanceService

beforeEach(async () => {
  factory = new FakeProviderFactory()
  factory.configure({ balance: 1_000n as Wei })

  clock = new FakeClock(1_700_000_000_000)

  const logger = new NullLogger()

  networks = new NetworkService({
    repository: new NetworkRepository(await createSecureMemoryStorage()),
    providerFactory: factory,
    logger,
    builtInNetworks: BUILT_IN_NETWORKS,
    defaultChainId: DEFAULT_CHAIN_ID,
  })

  await networks.init()

  service = new BalanceService({
    providers: new ProviderPool({ factory, logger }),
    networks,
    clock,
    logger,
    options: { freshnessMs: FRESHNESS_MS },
  })
})

describe('BalanceService.getNative', () => {
  it('возвращает значение от узла', async () => {
    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balance.raw).toBe(1_000n)
    expect(balance.isStale).toBe(false)
  })

  it('подставляет число знаков из конфигурации сети', async () => {
    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balance.decimals).toBe(18)
  })

  it('не обращается к узлу повторно, пока значение свежее', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    const createdAfterFirst = factory.createdCount

    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(factory.createdCount).toBe(createdAfterFirst)
  })

  it('помечает устаревшее значение', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    clock.advance(FRESHNESS_MS + 1)

    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    /* Устаревшее значение отдаётся, но помечается: решение об отправке
       по нему приводит к отказу сети. */
    expect(balance.isStale).toBe(true)
  })

  it('различает адреса, записанные в разном регистре', async () => {
    const first = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    const lowercase = toAddress(OWNER.toLowerCase())

    factory.configure({ balance: 2_000n as Wei })

    const second = await service.getNative(lowercase, BUILT_IN_CHAIN_ID.Ethereum)

    /* Один адрес в разном написании обязан попасть в одну запись кэша:
       иначе два виджета показали бы разные балансы одного счёта. */
    expect(second.raw).toBe(first.raw)
  })

  it('сообщает об отказе узла, а не возвращает ноль', async () => {
    factory.configure({ unavailable: true })

    await expect(service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).rejects.toThrow()
  })

  it('отказывает для незарегистрированной сети', async () => {
    await expect(service.getNative(OWNER, 999_999n as never)).rejects.toThrow()
  })
})

describe('BalanceService.getToken', () => {
  it('возвращает баланс нативной валюты по ссылке без контракта', async () => {
    const balance = await service.getToken(OWNER, {
      chainId: BUILT_IN_CHAIN_ID.Ethereum,
      address: null,
    })

    expect(balance.raw).toBe(1_000n)
  })

  it('отказывает по токену, когда сервис токенов не подключён', async () => {
    /* Нулевой баланс — утверждение «токенов нет». Без сервиса токенов
       кошелёк проверить это не может, и отказ честнее нуля. */
    await expect(
      service.getToken(OWNER, { chainId: BUILT_IN_CHAIN_ID.Ethereum, address: TOKEN_ADDRESS }),
    ).rejects.toBeInstanceOf(NotImplementedError)
  })
})

describe('BalanceService.getAll', () => {
  it('возвращает нативный баланс и пустой список токенов', async () => {
    const balances = await service.getAll(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balances.native.raw).toBe(1_000n)
    expect(balances.tokens).toHaveLength(0)
  })
})

describe('BalanceService.refresh', () => {
  it('запрашивает значение заново, минуя кэш', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    factory.configure({ balance: 5_000n as Wei })

    const balances = await service.refresh(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balances.native.raw).toBe(5_000n)
  })
})

describe('BalanceService.invalidate', () => {
  it('сбрасывает кэш целиком', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    service.invalidate()
    factory.configure({ balance: 7_000n as Wei })

    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).raw).toBe(7_000n)
  })

  it('сбрасывает кэш только указанной сети', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Polygon)

    service.invalidate(undefined, BUILT_IN_CHAIN_ID.Polygon)
    factory.configure({ balance: 9_000n as Wei })

    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).raw).toBe(1_000n)
    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Polygon)).raw).toBe(9_000n)
  })
})

describe('BalanceService.subscribe', () => {
  it('опрашивает узел по расписанию', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    let updates = 0
    service.on('balance:updated', () => {
      updates += 1
    })

    service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    clock.advance(30_000)

    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(0)
    })
  })

  it('прекращает опрос после отписки', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    const unsubscribe = service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    unsubscribe()

    let updates = 0
    service.on('balance:updated', () => {
      updates += 1
    })

    clock.advance(120_000)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(updates).toBe(0)
  })

  it('держит один таймер на нескольких подписчиков', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    const first = service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    first()

    let updates = 0
    service.on('balance:updated', () => {
      updates += 1
    })

    clock.advance(30_000)

    /* Отписка одного из двух не должна гасить опрос для второго. */
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(0)
    })
  })
})
