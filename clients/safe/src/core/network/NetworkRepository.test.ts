import { beforeEach, describe, expect, it } from 'vitest'

import type { SecureStorage } from '@/core/encryption'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import { MemoryStorageService, STORAGE_NAMESPACE, toStorageKey } from '@/core/storage'
import { toChainId, type ChainId } from '@/core/types'
import { createSecureMemoryStorage } from '@/test/doubles'

import { NetworkRepository } from './NetworkRepository'
import type { INetworkConfig } from './types'

const CUSTOM_CHAIN = toChainId(999n)

/** A node URL with an account key in the path — the usual form from an operator. */
const SECRET_RPC = 'https://rpc.example.com/v2/9f8c1b7e5a3d4f2e'

function config(overrides: Partial<INetworkConfig> = {}): INetworkConfig {
  return {
    chainId: CUSTOM_CHAIN,
    name: 'My Private Chain',
    rpcUrls: [SECRET_RPC],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: [],
    isTestnet: false,
    isBuiltIn: false,
    supportsEip1559: true,
    ...overrides,
  }
}

/**
 * Raw storage contents as a string.
 *
 * Secrets can only be checked against what actually sits on disk:
 * a value that went through the repository is already decrypted.
 */
async function rawDump(storage: MemoryStorageService): Promise<string> {
  const parts: string[] = []

  for (const namespace of [STORAGE_NAMESPACE.Networks, STORAGE_NAMESPACE.Settings]) {
    for (const key of await storage.keys(namespace)) {
      parts.push(JSON.stringify(await storage.get(namespace, key)))
    }
  }

  return parts.join('|')
}

let plain: MemoryStorageService
let secure: SecureStorage
let repository: NetworkRepository

beforeEach(async () => {
  plain = new MemoryStorageService()
  secure = await createSecureMemoryStorage(plain)
  repository = new NetworkRepository(secure, plain)
})

describe('Storing networks', () => {
  it('a saved network is read back', async () => {
    await repository.save(config())

    const restored = await repository.findByChainId(CUSTOM_CHAIN)

    expect(restored?.rpcUrls).toEqual([SECRET_RPC])
  })

  it('the node URL does not sit in storage in the clear', async () => {
    /* A custom network's `rpcUrls` usually hold a URL with an account
       key right in the path. In the clear on disk that is the same
       as a written-down password to a third-party service. */
    await repository.save(config())

    const dump = await rawDump(plain)

    expect(dump).not.toContain('9f8c1b7e5a3d4f2e')
    expect(dump).not.toContain('rpc.example.com')
  })

  it('a deleted network is no longer found', async () => {
    await repository.save(config())
    await repository.delete(CUSTOM_CHAIN)

    expect(await repository.findByChainId(CUSTOM_CHAIN)).toBeNull()
  })
})

describe('Migration from clear storage', () => {
  /** Writes a network the way older versions did: in the clear. */
  async function writeLegacy(chainId: ChainId = CUSTOM_CHAIN): Promise<void> {
    await plain.set(STORAGE_NAMESPACE.Networks, toStorageKey(chainId.toString()), {
      chainId: chainId.toString(),
      name: 'Legacy Chain',
      rpcUrls: [SECRET_RPC],
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: [],
      isTestnet: false,
      isBuiltIn: false,
      supportsEip1559: true,
    })
  }

  it('a network in the old format is not lost', async () => {
    /* Wallets created before network encryption must keep working:
       a custom network is the user's setting, not a cache. */
    await writeLegacy()

    const restored = await repository.findAll()

    expect(restored).toHaveLength(1)
    expect(restored[0]?.rpcUrls).toEqual([SECRET_RPC])
  })

  it('the clear record is removed after migration', async () => {
    /* Leaving it would mean encryption achieves nothing. */
    await writeLegacy()
    await repository.findAll()

    const dump = await rawDump(plain)

    expect(dump).not.toContain('9f8c1b7e5a3d4f2e')
  })

  it('migration also runs on a lookup by identifier', async () => {
    await writeLegacy()

    expect(await repository.findByChainId(CUSTOM_CHAIN)).not.toBeNull()
  })

  it('a second migration breaks nothing', async () => {
    await writeLegacy()
    await repository.findAll()

    expect(await repository.findAll()).toHaveLength(1)
  })

  it('without clear storage, migration does not run', async () => {
    /* A repository built without the old store works as usual:
       there is nothing to migrate. */
    const isolated = new NetworkRepository(secure)

    await isolated.save(config({ chainId: BUILT_IN_CHAIN_ID.Ethereum }))

    expect(await isolated.findAll()).toHaveLength(1)
  })
})
