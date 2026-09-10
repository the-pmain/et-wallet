import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
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

/** Arbitrary address: the call itself matters, not whose balance. */
const ETHEREUM_OWNER = toAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')

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

describe('RpcManager: source order', () => {
  it('uses public nodes when there is no key and no own addresses', () => {
    const endpoints = manager.listEndpoints(ETHEREUM)

    expect(endpoints.every((endpoint) => endpoint.providerId === RPC_PROVIDER_ID.Public)).toBe(true)
    expect(endpoints.map((endpoint) => endpoint.url)).toEqual(ETHEREUM.rpcUrls)
  })

  it('puts Alchemy ahead of public nodes', async () => {
    const withKey = await createManager('test-key')

    expect(withKey.listEndpoints(ETHEREUM)[0]?.providerId).toBe(RPC_PROVIDER_ID.Alchemy)
  })

  it('puts the user own node ahead of Alchemy', async () => {
    const withKey = await createManager('test-key')

    await custom.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://my-node.example')

    /* The user chose the address on purpose. Substituting a default
       would undo the owner's decision. */
    expect(withKey.listEndpoints(ETHEREUM)[0]?.providerId).toBe(RPC_PROVIDER_ID.Custom)
  })

  it('does not list the same address twice', async () => {
    const duplicated = ETHEREUM.rpcUrls[0] as string

    await custom.add(BUILT_IN_CHAIN_ID.Ethereum, duplicated)

    const urls = manager.listEndpoints(ETHEREUM).map((endpoint) => endpoint.url)

    expect(urls.filter((url) => url === duplicated)).toHaveLength(1)
  })

  it('skips a source that does not serve the network', async () => {
    const withKey = await createManager('test-key')
    const unknown: INetworkConfig = { ...ETHEREUM, chainId: toChainId(999_999n) }

    expect(
      withKey.listEndpoints(unknown).every((e) => e.providerId === RPC_PROVIDER_ID.Public),
    ).toBe(true)
  })
})

describe('RpcManager: connection cache', () => {
  it('reuses the connection on a later call', async () => {
    await manager.get(ETHEREUM)
    await manager.get(ETHEREUM)

    expect(factory.createdCount).toBe(1)
  })

  it('shares one creation among concurrent calls', async () => {
    await Promise.all([manager.get(ETHEREUM), manager.get(ETHEREUM), manager.get(ETHEREUM)])

    expect(factory.createdCount).toBe(1)
  })

  it('does not leave a rejected attempt in cache', async () => {
    factory.configure({ unavailable: true })

    await expect(manager.get(ETHEREUM)).rejects.toBeInstanceOf(ProviderUnavailableError)

    factory.configure({ balance: 1n as Wei })

    /* The next call must try again: the node may have recovered. */
    await expect(manager.get(ETHEREUM)).resolves.toBeDefined()
  })

  it('rebuilds a connection that exhausted its address list', async () => {
    const provider = await manager.get(ETHEREUM)

    /* The node died mid-session and does not come back: rotation
       walks every address and reaches the end of the list. */
    factory.lastProvider?.destroy()
    factory.configure({ unavailable: true })

    await expect(provider.getBalance(ETHEREUM_OWNER)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    )
    expect(provider.isActive).toBe(false)

    factory.configure({ balance: 5n as Wei })

    /* The nodes recovered. The exhausted provider must leave the
       cache, otherwise the wallet would report the network
       unavailable until reload without talking to the network at all. */
    const rebuilt = await manager.get(ETHEREUM)

    expect(rebuilt).not.toBe(provider)
    expect(await rebuilt.getBalance(ETHEREUM_OWNER)).toBe(5n)
  })

  it('closes the connection on release', async () => {
    await manager.get(ETHEREUM)
    await manager.release(ETHEREUM.chainId)

    expect(factory.lastProvider?.isActive).toBe(false)
  })

  it('closes every connection on destroy', async () => {
    await manager.get(ETHEREUM)
    await manager.destroy()

    expect(factory.lastProvider?.isActive).toBe(false)
    await expect(manager.get(ETHEREUM)).rejects.toBeInstanceOf(ProviderUnavailableError)
  })
})

describe('RpcManager: availability check', () => {
  it('checks every address on the network', async () => {
    const health = await manager.checkHealth(ETHEREUM)

    expect(health).toHaveLength(ETHEREUM.rpcUrls.length)
    expect(health.every((item) => item.isHealthy)).toBe(true)
  })

  it('measures response time', async () => {
    const health = await manager.checkHealth(ETHEREUM)

    expect(health[0]?.latencyMs).not.toBeNull()
  })

  it('reports the failure reason instead of staying silent', async () => {
    factory.configure({ unavailable: true })

    const health = await manager.checkHealth(ETHEREUM)

    expect(health.every((item) => !item.isHealthy)).toBe(true)
    expect(health[0]?.reason).not.toBeNull()
    expect(health[0]?.latencyMs).toBeNull()
  })

  it('separates a foreign network from unavailability', async () => {
    factory.configure({ reportedChainId: toChainId(137n), verifyChainIdOnCreate: true })

    const health = await manager.checkHealth(ETHEREUM)

    /* An unreachable node is an inconvenience. A node with a foreign
       chainId is a misconfiguration or an impersonation attempt, and
       that needs attention. */
    expect(health[0]?.isChainMismatch).toBe(true)
  })

  it('closes diagnostic connections', async () => {
    await manager.checkHealth(ETHEREUM)

    expect(factory.lastProvider?.isActive).toBe(false)
  })
})

describe('RpcManager: cooldown after failure', () => {
  it('excludes a failed address from the next attempts', async () => {
    factory.configure({ unavailable: true })
    await manager.checkHealth(ETHEREUM)

    factory.configure({ balance: 1n as Wei })

    /* Every address is on cooldown, so the list is not empty: refusing
       to connect while unchecked addresses exist is worse than trying. */
    await expect(manager.get(ETHEREUM)).resolves.toBeDefined()
  })

  it('returns the address to rotation after the cooldown ends', async () => {
    factory.configure({ unavailable: true })
    await manager.checkHealth(ETHEREUM)

    clock.advance(COOLDOWN_MS + 1)
    factory.configure({ balance: 1n as Wei })

    const health = await manager.checkHealth(ETHEREUM)

    expect(health.every((item) => item.isHealthy)).toBe(true)
  })
})

describe('RpcManager: user address', () => {
  it('saves the address after verifying the node', async () => {
    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')

    expect(custom.listUrls(ETHEREUM.chainId)).toEqual(['https://my-node.example'])
  })

  it('does not save an address of a node that serves another network', async () => {
    factory.configure({ reportedChainId: toChainId(137n), verifyChainIdOnCreate: true })

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'https://wrong-chain.example'),
    ).rejects.toBeInstanceOf(ChainIdMismatchError)

    /* Otherwise a foreign-network address would be applied on every
       launch: signatures made for another chain are valid for replay. */
    expect(custom.listUrls(ETHEREUM.chainId)).toHaveLength(0)
  })

  it('does not save an unreachable address', async () => {
    factory.configure({ unavailable: true })

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'https://offline.example'),
    ).rejects.toBeInstanceOf(ProviderUnavailableError)

    expect(custom.listUrls(ETHEREUM.chainId)).toHaveLength(0)
  })

  it('rejects cleartext HTTP before talking to the network', async () => {
    const before = factory.createdCount

    await expect(
      manager.addCustomEndpoint(ETHEREUM, 'http://insecure.example'),
    ).rejects.toBeInstanceOf(InsecureRpcUrlError)

    expect(factory.createdCount).toBe(before)
  })

  it('rebuilds the connection after adding an address', async () => {
    await manager.get(ETHEREUM)

    const before = factory.lastProvider

    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')

    /* Otherwise the user's choice would not apply until restart. */
    expect(before?.isActive).toBe(false)
  })

  it('removes the address and returns to the previous sources', async () => {
    await manager.addCustomEndpoint(ETHEREUM, 'https://my-node.example')
    await manager.removeCustomEndpoint(ETHEREUM, 'https://my-node.example')

    expect(manager.listEndpoints(ETHEREUM).map((endpoint) => endpoint.url)).toEqual(
      ETHEREUM.rpcUrls,
    )
  })
})
