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
import {
  FakeProviderFactory,
  InMemoryStorageService,
  NullLogger,
  createSecureMemoryStorage,
} from '@/test/doubles'

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

async function createContext(storage = new InMemoryStorageService()): Promise<ITestContext> {
  /* Networks are stored encrypted: the repository gets a secure store
     over the same memory the check can see. */
  const repository = new NetworkRepository(await createSecureMemoryStorage(storage))
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

describe('NetworkService: initialisation', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = await createContext()
  })

  it('refuses access to the active network before init()', () => {
    expect(() => context.service.getActive()).toThrow(NotInitializedError)
  })

  it('loads built-in networks', async () => {
    await context.service.init()

    expect(context.service.list()).toHaveLength(BUILT_IN_NETWORKS.length)
  })

  it('selects the default network on first launch', async () => {
    await context.service.init()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })

  it('is idempotent on a second call', async () => {
    await context.service.init()
    await context.service.init()

    expect(context.service.list()).toHaveLength(BUILT_IN_NETWORKS.length)
  })

  it('restores the saved active-network choice', async () => {
    await context.service.init()
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Polygon)

    const restored = await createContext(context.storage)
    await restored.service.init()

    expect(restored.service.getActive().chainId).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('ignores a saved choice of a missing network', async () => {
    await context.repository.setActiveChainId(toChainId(999999))
    await context.service.init()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: protecting built-in networks from impersonation', () => {
  it('ignores a stored copy of a built-in network', async () => {
    const storage = new InMemoryStorageService()
    const repository = new NetworkRepository(await createSecureMemoryStorage(storage))

    /* Impersonation stand-in: storage holds Ethereum with a foreign RPC. */
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

    const context = await createContext(storage)
    await context.service.init()

    const ethereum = context.service.getByChainId(BUILT_IN_CHAIN_ID.Ethereum)

    expect(ethereum?.rpcUrls).not.toContain('https://attacker.example.com')
  })

  it('logs the discarded record', async () => {
    const storage = new InMemoryStorageService()
    const repository = new NetworkRepository(await createSecureMemoryStorage(storage))
    const [ethereum] = BUILT_IN_NETWORKS

    await repository.save(ethereum as INetworkConfig)

    const context = await createContext(storage)
    await context.service.init()

    const warnings = context.logger.records.filter((record) => record.level === 'warn')

    expect(warnings).toHaveLength(1)
  })
})

describe('NetworkService: switching networks', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = await createContext()
    await context.service.init()
  })

  it('changes the active network', async () => {
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Arbitrum)

    expect(context.service.getActive().chainId).toBe(BUILT_IN_CHAIN_ID.Arbitrum)
  })

  it('emits a network:changed event', async () => {
    const listener = vi.fn()
    context.service.on('network:changed', listener)

    await context.service.switchTo(BUILT_IN_CHAIN_ID.Base)

    expect(listener).toHaveBeenCalledExactlyOnceWith({ chainId: BUILT_IN_CHAIN_ID.Base })
  })

  it('does not emit an event when switching to the already active network', async () => {
    const listener = vi.fn()
    context.service.on('network:changed', listener)

    await context.service.switchTo(DEFAULT_CHAIN_ID)

    expect(listener).not.toHaveBeenCalled()
  })

  it('persists the choice in storage', async () => {
    await context.service.switchTo(BUILT_IN_CHAIN_ID.Optimism)

    await expect(context.repository.getActiveChainId()).resolves.toBe(BUILT_IN_CHAIN_ID.Optimism)
  })

  it('refuses a switch to an unregistered network', async () => {
    await expect(context.service.switchTo(toChainId(999999))).rejects.toThrow(NetworkNotFoundError)
  })

  it('does not change the active network on refusal', async () => {
    await expect(context.service.switchTo(toChainId(999999))).rejects.toThrow()

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: adding a network', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = await createContext()
    await context.service.init()
  })

  it('adds a custom network', async () => {
    const added = await context.service.add(customNetworkParams())

    expect(added.chainId).toBe(CUSTOM_CHAIN_ID)
    expect(added.isBuiltIn).toBe(false)
    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).not.toBeNull()
  })

  it('persists the network in storage', async () => {
    await context.service.add(customNetworkParams())

    const restored = await createContext(context.storage)
    await restored.service.init()

    expect(restored.service.getByChainId(CUSTOM_CHAIN_ID)?.name).toBe('Local Node')
  })

  it('emits a network:listChanged event', async () => {
    const listener = vi.fn()
    context.service.on('network:listChanged', listener)

    await context.service.add(customNetworkParams())

    expect(listener).toHaveBeenCalledOnce()
  })

  it('rejects a network whose identifier already exists', async () => {
    await expect(
      context.service.add(customNetworkParams({ chainId: BUILT_IN_CHAIN_ID.Ethereum })),
    ).rejects.toThrow(NetworkAlreadyExistsError)
  })

  it('rejects a network that bears a built-in name', async () => {
    /* Checking chainId with the node will not catch this: the node
       will honestly confirm its identifier. A name match is the only
       signal. */
    await expect(context.service.add(customNetworkParams({ name: 'Ethereum' }))).rejects.toThrow(
      NetworkImpersonationError,
    )
  })

  it('does not talk to the node after detecting a name impersonation', async () => {
    const before = context.providerFactory.createdCount

    await expect(
      context.service.add(customNetworkParams({ name: 'Ethereum' })),
    ).rejects.toBeInstanceOf(NetworkImpersonationError)

    /* The name check is free and runs first: there is no need to wait
       for the node to reject a configuration that is already unsafe. */
    expect(context.providerFactory.createdCount).toBe(before)
  })

  it('names the network the addition is posing as', async () => {
    try {
      await context.service.add(customNetworkParams({ name: 'Polygon' }))
      expect.unreachable('add should have been refused')
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkImpersonationError)
      expect((error as NetworkImpersonationError).impersonatedChainId).toBe(
        BUILT_IN_CHAIN_ID.Polygon,
      )
    }
  })

  it('adds a same-named network on explicit consent', async () => {
    const added = await context.service.add(
      customNetworkParams({ name: 'Ethereum', allowImpersonation: true }),
    )

    /* Consent must be a separate action, but the operation cannot be
       banned outright: the user may have a lawful reason. */
    expect(added.name).toBe('Ethereum')
    expect(added.chainId).toBe(CUSTOM_CHAIN_ID)
  })

  it('does not treat a uniquely named network as impersonation', async () => {
    await expect(
      context.service.add(customNetworkParams({ name: 'My Private Chain' })),
    ).resolves.toBeDefined()
  })

  it('rejects an insecure RPC URL', async () => {
    await expect(
      context.service.add(customNetworkParams({ rpcUrls: ['http://node.example.com'] })),
    ).rejects.toThrow(InsecureRpcUrlError)
  })

  it('rejects an insecure explorer URL', async () => {
    await expect(
      context.service.add(
        customNetworkParams({ blockExplorerUrls: ['http://explorer.example.com'] }),
      ),
    ).rejects.toThrow(InsecureRpcUrlError)
  })

  it('does not talk to the node if the URLs failed the check', async () => {
    await expect(
      context.service.add(customNetworkParams({ rpcUrls: ['http://node.example.com'] })),
    ).rejects.toThrow()

    expect(context.providerFactory.createdCount).toBe(0)
  })

  it('rejects the network if the node reports a foreign chainId', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow(ChainIdMismatchError)
  })

  it('does not persist the network when chainId mismatches', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow()

    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).toBeNull()
    await expect(context.repository.findByChainId(CUSTOM_CHAIN_ID)).resolves.toBeNull()
  })

  it('closes the connection after the check', async () => {
    await context.service.add(customNetworkParams())

    expect(context.providerFactory.lastProvider?.isActive).toBe(false)
  })

  it('closes the connection even when chainId mismatches', async () => {
    context.providerFactory.configure({ reportedChainId: toChainId(1) })

    await expect(context.service.add(customNetworkParams())).rejects.toThrow()

    expect(context.providerFactory.lastProvider?.isActive).toBe(false)
  })
})

describe('NetworkService: removing a network', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = await createContext()
    await context.service.init()
    await context.service.add(customNetworkParams())
  })

  it('removes a custom network', async () => {
    await context.service.remove(CUSTOM_CHAIN_ID)

    expect(context.service.getByChainId(CUSTOM_CHAIN_ID)).toBeNull()
  })

  it('removes the record from storage', async () => {
    await context.service.remove(CUSTOM_CHAIN_ID)

    await expect(context.repository.findByChainId(CUSTOM_CHAIN_ID)).resolves.toBeNull()
  })

  it('refuses to remove a built-in network', async () => {
    await expect(context.service.remove(BUILT_IN_CHAIN_ID.Ethereum)).rejects.toThrow(
      BuiltInNetworkImmutableError,
    )
  })

  it('refuses to remove an unregistered network', async () => {
    await expect(context.service.remove(toChainId(999999))).rejects.toThrow(NetworkNotFoundError)
  })

  it('switches to the default network when the active one is removed', async () => {
    await context.service.switchTo(CUSTOM_CHAIN_ID)
    await context.service.remove(CUSTOM_CHAIN_ID)

    expect(context.service.getActive().chainId).toBe(DEFAULT_CHAIN_ID)
  })
})

describe('NetworkService: updating a network', () => {
  let context: ITestContext

  beforeEach(async () => {
    context = await createContext()
    await context.service.init()
    await context.service.add(customNetworkParams())
  })

  it('changes the name of a custom network', async () => {
    const updated = await context.service.update(CUSTOM_CHAIN_ID, { name: 'New name' })

    expect(updated.name).toBe('New name')
  })

  it('does not change the network identifier', async () => {
    const updated = await context.service.update(CUSTOM_CHAIN_ID, {
      chainId: toChainId(777),
      name: 'Impersonation',
    })

    expect(updated.chainId).toBe(CUSTOM_CHAIN_ID)
    expect(context.service.getByChainId(toChainId(777))).toBeNull()
  })

  it('refuses to update a built-in network', async () => {
    await expect(
      context.service.update(BUILT_IN_CHAIN_ID.Ethereum, { name: 'Fake Ethereum' }),
    ).rejects.toThrow(BuiltInNetworkImmutableError)
  })

  it('rejects an insecure RPC URL', async () => {
    await expect(
      context.service.update(CUSTOM_CHAIN_ID, { rpcUrls: ['http://node.example.com'] }),
    ).rejects.toThrow(InsecureRpcUrlError)
  })
})
