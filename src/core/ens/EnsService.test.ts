import { beforeEach, describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID, BUILT_IN_NETWORKS } from '@/core/network'
import type { INetworkConfig, INetworkService } from '@/core/network'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { ChainId } from '@/core/types'
import { FakeClock, FakeProviderFactory, NullLogger, type IFakeEnsRecord } from '@/test/doubles'

import { EnsService } from './EnsService'

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const OTHER = toAddress('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359')

/** Network by identifier. Taken from the built-in list, not invented. */
function networkOf(chainId: ChainId): INetworkConfig {
  const found = BUILT_IN_NETWORKS.find((network) => network.chainId === chainId)

  if (found === undefined) {
    throw new Error(`Built-in network ${chainId.toString()} is missing.`)
  }

  return found
}

/** Network-service stand-in: returns the given active network. */
function fakeNetworks(active: INetworkConfig): INetworkService {
  return {
    getActive: () => active,
    list: () => BUILT_IN_NETWORKS,
  } as unknown as INetworkService
}

let factory: FakeProviderFactory
let clock: FakeClock

/** Builds the service over a stand-in with the given ENS records. */
function createService(records: readonly IFakeEnsRecord[], chainId = BUILT_IN_CHAIN_ID.Ethereum) {
  factory = new FakeProviderFactory()
  factory.configure({ ensRecords: records })

  const network = networkOf(chainId)

  /* The provider resolver creates a connection once and reuses it:
     otherwise the node-access counter would count connections, not
     requests. */
  let provider: IProvider | null = null

  const resolver: IProviderResolver = {
    get: async () => {
      provider ??= await factory.create(network)

      return provider
    },
  }

  return new EnsService({
    resolver,
    networks: fakeNetworks(network),
    clock,
    logger: new NullLogger(),
  })
}

beforeEach(() => {
  clock = new FakeClock(1_700_000_000_000)
})

describe('EnsService: supported networks', () => {
  it('works on Ethereum', () => {
    expect(createService([]).isSupported(BUILT_IN_CHAIN_ID.Ethereum)).toBe(true)
  })

  it.each([BUILT_IN_CHAIN_ID.Polygon, BUILT_IN_CHAIN_ID.Base, BUILT_IN_CHAIN_ID.Arbitrum])(
    'does not work on network %s',
    (chainId) => {
      expect(createService([]).isSupported(chainId)).toBe(false)
    },
  )

  it('on another network a name is not resolved at all', async () => {
    /* Opening a second connection to an Ethereum node would tell a
       third-party operator what the user is looking up and from which
       address, while they believe they are on another network. */
    const service = createService(
      [{ name: 'vitalik.eth', address: OWNER }],
      BUILT_IN_CHAIN_ID.Polygon,
    )

    await expect(service.resolveName('vitalik.eth')).resolves.toBeNull()
  })
})

describe('EnsService: forward resolution', () => {
  it('resolves a name to an address', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('vitalik.eth')).resolves.toEqual({
      name: 'vitalik.eth',
      displayName: 'vitalik.eth',
      isAscii: true,
      address: OWNER,
    })
  })

  it('strips case before hashing', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('Vitalik.ETH')).resolves.toMatchObject({ address: OWNER })
  })

  it('an unregistered name yields null', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()
  })

  it('a record with a zero address yields null, not the burn address', async () => {
    /* Taking zero as the recipient, the wallet would send funds where
       no one can retrieve them. */
    const service = createService([{ name: 'empty.eth', address: null }])

    await expect(service.resolveName('empty.eth')).resolves.toBeNull()
  })

  it('a name that fails normalisation yields null without a node request', async () => {
    /* Mixed scripts are rejected before talking to the network:
       there is no point asking the node about a name that is unfit. */
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(
      service.resolveName(`vit${String.fromCodePoint(0x0430)}lik.eth`),
    ).resolves.toBeNull()
    expect(factory.createdCount).toBe(0)
  })

  it('resolves a name with an emoji', async () => {
    /* Full ENSIP-15 normalisation: the name is lawful and must work. */
    const service = createService([{ name: '\u{1F600}.eth', address: OWNER }])

    await expect(service.resolveName('\u{1F600}.eth')).resolves.toMatchObject({
      address: OWNER,
      displayName: '\u{1F600}\u{FE0F}.eth',
      isAscii: false,
    })
  })
})

describe('EnsService: reverse resolution', () => {
  it('returns a name confirmed by forward resolution', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER, reverseFor: OWNER }])

    await expect(service.lookupAddress(OWNER)).resolves.toMatchObject({ name: 'vitalik.eth' })
  })

  it('rejects a name that points to another address', async () => {
    /* THE MOST IMPORTANT CHECK IN THE MODULE. The reverse record is
       set by the address owner, and anyone may call themselves
       `vitalik.eth`. Showing it without a check would stamp a fake
       with the wallet's own interface. */
    const service = createService([{ name: 'vitalik.eth', address: OWNER, reverseFor: OTHER }])

    await expect(service.lookupAddress(OTHER)).resolves.toBeNull()
  })

  it('rejects a name that has no forward record', async () => {
    const service = createService([{ name: 'vitalik.eth', address: null, reverseFor: OTHER }])

    await expect(service.lookupAddress(OTHER)).resolves.toBeNull()
  })

  it('an address with no reverse record yields null', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await expect(service.lookupAddress(OWNER)).resolves.toBeNull()
  })

  it('does not depend on address case', async () => {
    const service = createService([
      { name: 'vitalik.eth', address: OWNER, reverseFor: OWNER.toLowerCase() },
    ])

    await expect(service.lookupAddress(OWNER)).resolves.toMatchObject({ name: 'vitalik.eth' })
  })
})

describe('EnsService: cache', () => {
  it('a repeat request does not create a new connection', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')
    const afterFirst = factory.createdCount

    await service.resolveName('vitalik.eth')

    expect(factory.createdCount).toBe(afterFirst)
  })

  it('remembers the absence of a record', async () => {
    /* The input field talks to the service on every keystroke, and
       an unfinished name is the most common request. */
    const service = createService([])

    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()
    await expect(service.resolveName('nobody.eth')).resolves.toBeNull()

    expect(factory.createdCount).toBe(1)
  })

  it('a stale record is read again', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')

    clock.advance(6 * 60 * 1000)
    factory.configure({ ensRecords: [{ name: 'vitalik.eth', address: OTHER }] })

    await expect(service.resolveName('vitalik.eth')).resolves.toMatchObject({ address: OTHER })
  })

  it('clearing the cache forces a fresh node request', async () => {
    const service = createService([{ name: 'vitalik.eth', address: OWNER }])

    await service.resolveName('vitalik.eth')
    service.clearCache()
    factory.configure({ ensRecords: [{ name: 'vitalik.eth', address: OTHER }] })

    await expect(service.resolveName('vitalik.eth')).resolves.toMatchObject({ address: OTHER })
  })
})
