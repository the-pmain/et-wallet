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
  it('returns the value from the node', async () => {
    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balance.raw).toBe(1_000n)
    expect(balance.isStale).toBe(false)
  })

  it('fills decimals from the network config', async () => {
    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balance.decimals).toBe(18)
  })

  it('does not talk to the node again while the value is fresh', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    const createdAfterFirst = factory.createdCount

    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(factory.createdCount).toBe(createdAfterFirst)
  })

  it('marks a stale value', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    clock.advance(FRESHNESS_MS + 1)

    const balance = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    /* The stale value is returned, but marked: a send decision
       based on it leads to the network refusing. */
    expect(balance.isStale).toBe(true)
  })

  it('treats the same address in different case as one', async () => {
    const first = await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    const lowercase = toAddress(OWNER.toLowerCase())

    factory.configure({ balance: 2_000n as Wei })

    const second = await service.getNative(lowercase, BUILT_IN_CHAIN_ID.Ethereum)

    /* One address in different spellings must hit the same cache
       entry: otherwise two widgets would show different balances
       of the same account. */
    expect(second.raw).toBe(first.raw)
  })

  it('reports a node failure instead of returning zero', async () => {
    factory.configure({ unavailable: true })

    await expect(service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).rejects.toThrow()
  })

  it('fails for an unregistered network', async () => {
    await expect(service.getNative(OWNER, 999_999n as never)).rejects.toThrow()
  })
})

describe('BalanceService.getToken', () => {
  it('returns the native balance for a reference with no contract', async () => {
    const balance = await service.getToken(OWNER, {
      chainId: BUILT_IN_CHAIN_ID.Ethereum,
      address: null,
    })

    expect(balance.raw).toBe(1_000n)
  })

  it('fails for a token when the token service is not wired', async () => {
    /* A zero balance is the claim "there are no tokens". Without a
       token service the wallet cannot check that, and a failure is
       more honest than zero. */
    await expect(
      service.getToken(OWNER, { chainId: BUILT_IN_CHAIN_ID.Ethereum, address: TOKEN_ADDRESS }),
    ).rejects.toBeInstanceOf(NotImplementedError)
  })
})

describe('BalanceService.getAll', () => {
  it('returns the native balance and an empty token list', async () => {
    const balances = await service.getAll(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balances.native.raw).toBe(1_000n)
    expect(balances.tokens).toHaveLength(0)
  })
})

describe('BalanceService.refresh', () => {
  it('re-fetches the value, bypassing the cache', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    factory.configure({ balance: 5_000n as Wei })

    const balances = await service.refresh(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    expect(balances.native.raw).toBe(5_000n)
  })
})

describe('BalanceService.invalidate', () => {
  it('clears the whole cache', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    service.invalidate()
    factory.configure({ balance: 7_000n as Wei })

    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).raw).toBe(7_000n)
  })

  it('clears the cache of only the given network', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Polygon)

    service.invalidate(undefined, BUILT_IN_CHAIN_ID.Polygon)
    factory.configure({ balance: 9_000n as Wei })

    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)).raw).toBe(1_000n)
    expect((await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Polygon)).raw).toBe(9_000n)
  })
})

describe('BalanceService.subscribe', () => {
  it('polls the node on a schedule', async () => {
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

  it('stops polling after unsubscribe', async () => {
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

  it('keeps one timer for several subscribers', async () => {
    await service.getNative(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    const first = service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)
    service.subscribe(OWNER, BUILT_IN_CHAIN_ID.Ethereum)

    first()

    let updates = 0
    service.on('balance:updated', () => {
      updates += 1
    })

    clock.advance(30_000)

    /* Unsubscribing one of two must not stop the poll for the other. */
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(0)
    })
  })
})
