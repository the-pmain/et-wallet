import { areAddressesEqual } from '@/core/address'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { Address, ChainId, HexString, Timestamp } from '@/core/types'

import type { IEnsResolution, IEnsService } from './contracts'
import { beautifyEnsName, isAsciiEnsName, normalizeEnsName } from './ens-name'
import { namehash, reverseNode } from './namehash'
import {
  ENS_ADDR_SELECTOR,
  ENS_CHAIN_ID,
  ENS_REGISTRY_ADDRESS,
  ENS_NAME_SELECTOR,
  ENS_RESOLVER_SELECTOR,
  decodeAddressWord,
  decodeStringResult,
  encodeNodeCall,
} from './registry'

const SERVICE_NAME = 'EnsService'

/**
 * Cache entry lifetime.
 *
 * Names change owners: registration expires, the record is
 * rewritten. Five minutes is the compromise between "do not ask
 * the node on every keystroke" and "do not show yesterday's
 * owner". Before funds are sent the name is resolved again —
 * the cache does not affect that, because transfer confirmation
 * goes by address, not by name.
 */
const CACHE_TTL_MS = 5 * 60 * 1000

/** Cache entry. `value` is `null` when ENS has no record. */
interface ICacheEntry<TValue> {
  readonly value: TValue | null
  readonly at: Timestamp
}

export interface IEnsServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * ENS name resolution over the active connection.
 *
 * WORKS ONLY WHEN THE ETHEREUM NETWORK IS ACTIVE. The ENS registry
 * exists on one chain, and resolving a name from Polygon would
 * mean opening a second connection — to an Ethereum node that is
 * then told which name and from which address the user is looking
 * up. That request would leave unnoticed by an owner who believes
 * they are on another network. The decision about a second operator
 * is theirs, not a default in the code; until that choice exists,
 * ENS is available where it lives.
 *
 * THE CACHE STORES NEGATIVE ANSWERS TOO. The recipient field talks
 * to the service on every keystroke, and an unfinished name is the
 * most common request. Without remembering "no record", the wallet
 * would query the node dozens of times for one typed name.
 *
 * NODE FAILURES ARE NEVER CACHED: remembering "unknown" for five
 * minutes would turn a single network glitch into a five-minute
 * outage.
 */
export class EnsService implements IEnsService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #forward = new Map<string, ICacheEntry<IEnsResolution>>()
  readonly #reverse = new Map<string, ICacheEntry<IEnsResolution>>()

  constructor(dependencies: IEnsServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  isSupported(chainId: ChainId): boolean {
    return chainId === ENS_CHAIN_ID
  }

  async resolveName(name: string): Promise<IEnsResolution | null> {
    const normalized = normalizeEnsName(name)

    if (normalized === null) {
      return null
    }

    const cached = EnsService.#read(this.#forward, normalized, this.#clock.now())

    if (cached !== undefined) {
      return cached
    }

    const provider = await this.#provider()

    if (provider === null) {
      return null
    }

    const node = namehash(normalized)
    const resolverAddress = await this.#resolverOf(provider, node)

    if (resolverAddress === null) {
      this.#remember(this.#forward, normalized, null)

      return null
    }

    const address = decodeAddressWord(
      await provider.call({ to: resolverAddress, data: encodeNodeCall(ENS_ADDR_SELECTOR, node) }),
    )

    if (address === null) {
      this.#remember(this.#forward, normalized, null)

      return null
    }

    const resolution: IEnsResolution = {
      name: normalized,
      displayName: beautifyEnsName(normalized),
      isAscii: isAsciiEnsName(normalized),
      address,
    }

    this.#remember(this.#forward, normalized, resolution)

    return resolution
  }

  async lookupAddress(address: Address): Promise<IEnsResolution | null> {
    const key = address.toLowerCase()
    const cached = EnsService.#read(this.#reverse, key, this.#clock.now())

    if (cached !== undefined) {
      return cached
    }

    const provider = await this.#provider()

    if (provider === null) {
      return null
    }

    const node = reverseNode(address)
    const resolverAddress = await this.#resolverOf(provider, node)

    if (resolverAddress === null) {
      this.#remember(this.#reverse, key, null)

      return null
    }

    const claimed = decodeStringResult(
      await provider.call({ to: resolverAddress, data: encodeNodeCall(ENS_NAME_SELECTOR, node) }),
    )

    const verified = claimed === null ? null : await this.#verify(address, claimed)

    this.#remember(this.#reverse, key, verified)

    return verified
  }

  clearCache(): void {
    this.#forward.clear()
    this.#reverse.clear()
  }

  /**
   * Confirms a reverse record with a forward resolve.
   *
   * THE MOST IMPORTANT CHECK IN THE WHOLE MODULE. A reverse record
   * is set by the address owner and checked by nobody: anyone may
   * declare `binance.eth` as their name. The only thing that makes
   * the name meaningful is that the address the name itself points
   * at matches the address the name was asked of.
   *
   * A mismatch is written to the log: this is not a failure, it is
   * an attempt to pass as someone else, and a trace of it must remain.
   */
  async #verify(address: Address, claimed: string): Promise<IEnsResolution | null> {
    const normalized = normalizeEnsName(claimed)

    if (normalized === null) {
      /* The name failed ENSIP-15: mixed scripts, a forbidden
         character, or an `xn--` label. Showing it unchecked would
         show exactly the string that is forged. */
      this.#logger.warn('The ENS reverse record failed normalisation', {
        note: 'the name is not shown; the address is displayed instead',
      })

      return null
    }

    const forward = await this.resolveName(normalized)

    if (forward === null || !areAddressesEqual(forward.address, address)) {
      this.#logger.warn('The ENS reverse record was not confirmed by forward resolution', {
        note: 'the name is not shown: the owner of an address may claim any name',
      })

      return null
    }

    return forward
  }

  /** Resolver address of the node, or `null` if the node is unregistered. */
  async #resolverOf(provider: IProvider, node: HexString): Promise<Address | null> {
    return decodeAddressWord(
      await provider.call({
        to: ENS_REGISTRY_ADDRESS,
        data: encodeNodeCall(ENS_RESOLVER_SELECTOR, node),
      }),
    )
  }

  /**
   * Connection to the network the registry lives on.
   *
   * `null` if another network is active. A second connection is
   * not opened here — see the class note.
   */
  async #provider(): Promise<IProvider | null> {
    const network = this.#networks.getActive()

    if (!this.isSupported(network.chainId)) {
      return null
    }

    return await this.#resolver.get(network)
  }

  #remember<TValue>(
    cache: Map<string, ICacheEntry<TValue>>,
    key: string,
    value: TValue | null,
  ): void {
    cache.set(key, { value, at: this.#clock.now() })
  }

  /**
   * Reads the cache.
   *
   * @returns `undefined` if there is no entry or it is stale; `null`
   *          if the absence of an ENS record was remembered.
   */
  static #read<TValue>(
    cache: Map<string, ICacheEntry<TValue>>,
    key: string,
    now: Timestamp,
  ): TValue | null | undefined {
    const entry = cache.get(key)

    if (entry === undefined) {
      return undefined
    }

    if (now - entry.at > CACHE_TTL_MS) {
      cache.delete(key)

      return undefined
    }

    return entry.value
  }
}
