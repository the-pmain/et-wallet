import { beforeEach, describe, expect, it } from 'vitest'

import { SecureStorage } from '@/core/encryption'
import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS, type INetworkConfig } from '@/core/network'
import { MemoryStorageService } from '@/core/storage'
import { toChainId } from '@/core/types'
import { FastEncryptionService } from '@/test/doubles'

import { AlchemyProvider } from './AlchemyProvider'
import { CustomRpcProvider } from './CustomRpcProvider'
import { PublicRpcProvider } from './PublicRpcProvider'
import { RPC_PROVIDER_ID } from './rpc-endpoint'

const PASSWORD = 'Korova-7-Luna!'

const ETHEREUM = BUILT_IN_NETWORKS.find(
  (network) => network.chainId === BUILT_IN_CHAIN_ID.Ethereum,
) as INetworkConfig

/** Network that Alchemy does not serve. */
const UNKNOWN_NETWORK: INetworkConfig = {
  ...ETHEREUM,
  chainId: toChainId(999_999n),
}

describe('AlchemyProvider', () => {
  it('gives no addresses without a key', () => {
    const provider = new AlchemyProvider({ apiKey: null })

    expect(provider.isConfigured).toBe(false)
    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('treats an empty string as no key', () => {
    /* A declared and blank env variable arrives exactly this way.
       Without normalization the source would emit an address with an
       empty key. */
    const provider = new AlchemyProvider({ apiKey: '' })

    expect(provider.isConfigured).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('builds an address with the key and the network subdomain', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })
    const [endpoint] = provider.listEndpoints(ETHEREUM)

    expect(endpoint?.url).toBe('https://eth-mainnet.g.alchemy.com/v2/test-key')
    expect(endpoint?.providerId).toBe(RPC_PROVIDER_ID.Alchemy)
  })

  it('uses different subdomains for different networks', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })
    const polygon = BUILT_IN_NETWORKS.find(
      (network) => network.chainId === BUILT_IN_CHAIN_ID.Polygon,
    ) as INetworkConfig

    expect(provider.listEndpoints(polygon)[0]?.url).toContain('polygon-mainnet')
  })

  it('serves every built-in network', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    for (const network of BUILT_IN_NETWORKS) {
      expect(provider.supports(network.chainId)).toBe(true)
    }
  })

  it('does not serve an unknown network', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    expect(provider.supports(UNKNOWN_NETWORK.chainId)).toBe(false)
    expect(provider.listEndpoints(UNKNOWN_NETWORK)).toHaveLength(0)
  })

  it('emits only https', () => {
    const provider = new AlchemyProvider({ apiKey: 'test-key' })

    for (const network of BUILT_IN_NETWORKS) {
      for (const endpoint of provider.listEndpoints(network)) {
        expect(endpoint.url.startsWith('https://')).toBe(true)
      }
    }
  })
})

describe('PublicRpcProvider', () => {
  it('emits addresses from network config', () => {
    const provider = new PublicRpcProvider()
    const endpoints = provider.listEndpoints(ETHEREUM)

    expect(endpoints.map((endpoint) => endpoint.url)).toEqual(ETHEREUM.rpcUrls)
  })

  it('marks the origin of the addresses', () => {
    const provider = new PublicRpcProvider()

    for (const endpoint of provider.listEndpoints(ETHEREUM)) {
      expect(endpoint.providerId).toBe(RPC_PROVIDER_ID.Public)
    }
  })
})

describe('CustomRpcProvider', () => {
  let storage: MemoryStorageService
  let secure: SecureStorage
  let provider: CustomRpcProvider

  beforeEach(async () => {
    storage = new MemoryStorageService()
    secure = new SecureStorage(storage, new FastEncryptionService())

    await secure.initialize(PASSWORD)

    provider = new CustomRpcProvider(secure)
    await provider.init(BUILT_IN_NETWORKS)
  })

  it('is empty until the user adds something', () => {
    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
    expect(provider.listEndpoints(ETHEREUM)).toHaveLength(0)
  })

  it('emits an added address', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    const [endpoint] = provider.listEndpoints(ETHEREUM)

    expect(endpoint?.url).toBe('https://node.example.com')
    expect(endpoint?.providerId).toBe(RPC_PROVIDER_ID.Custom)
  })

  it('rejects an address over cleartext HTTP', async () => {
    /* A man-in-the-middle on an unprotected channel swaps the
       balance and the gas price — the user would sign a transaction
       different from the one shown. */
    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'http://node.example.com'),
    ).rejects.toBeInstanceOf(InsecureRpcUrlError)
  })

  it('rejects a string that is not an address', async () => {
    await expect(provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'not-an-address')).rejects.toBeInstanceOf(
      InvalidRpcUrlError,
    )
  })

  it('rejects adding the same address twice', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com'),
    ).rejects.toBeInstanceOf(InvalidArgumentError)
  })

  it('caps the number of addresses per network', async () => {
    for (let index = 0; index < 8; index += 1) {
      await provider.add(BUILT_IN_CHAIN_ID.Ethereum, `https://node-${String(index)}.example.com`)
    }

    await expect(
      provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node-9.example.com'),
    ).rejects.toBeInstanceOf(InvalidArgumentError)
  })

  it('does not mix addresses of different networks', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://eth.example.com')
    await provider.add(BUILT_IN_CHAIN_ID.Polygon, 'https://polygon.example.com')

    expect(provider.listUrls(BUILT_IN_CHAIN_ID.Ethereum)).toEqual(['https://eth.example.com'])
    expect(provider.listUrls(BUILT_IN_CHAIN_ID.Polygon)).toEqual(['https://polygon.example.com'])
  })

  it('removes an address', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')
    await provider.remove(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    expect(provider.supports(BUILT_IN_CHAIN_ID.Ethereum)).toBe(false)
  })

  it('does not treat removing a missing address as an error', async () => {
    await expect(
      provider.remove(BUILT_IN_CHAIN_ID.Ethereum, 'https://absent.example.com'),
    ).resolves.toBeUndefined()
  })

  it('survives a session restart', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    const restored = new CustomRpcProvider(secure)
    await restored.init(BUILT_IN_NETWORKS)

    expect(restored.listUrls(BUILT_IN_CHAIN_ID.Ethereum)).toEqual(['https://node.example.com'])
  })

  it('does not leave the address in the clear', async () => {
    const url = 'https://node.example.com/v2/secret-key'

    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, url)

    const keys = await storage.keys('rpc-endpoints')
    const stored = await storage.get('rpc-endpoints', keys[0]!)

    /* The user pastes a string with their operator-account key.
       Storing it in the clear is the same as storing a password. */
    expect(JSON.stringify(stored)).not.toContain('secret-key')
  })

  it('does not land in the network-config namespace', async () => {
    await provider.add(BUILT_IN_CHAIN_ID.Ethereum, 'https://node.example.com')

    /* `NetworkRepository.findAll` reads every key in its namespace
       and parses each as a network config: a stray record next to
       them would become a corrupted network in the list. */
    expect(await storage.keys('networks')).toHaveLength(0)
  })
})
