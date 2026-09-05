import type { ISecureStorage } from '@/core/encryption'
import { InvalidArgumentError } from '@/core/errors'
import { assertValidRpcUrl, type INetworkConfig } from '@/core/network'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Your own node'

/**
 * Cap on addresses per network.
 *
 * Limits storage clutter and endless rotation on connect: each
 * unanswered address adds delay.
 */
const MAX_ENDPOINTS_PER_NETWORK = 8

/**
 * RPC addresses added by the user.
 *
 * WHAT THIS CLOSES. Built-in networks are immutable on purpose: an
 * overwritten mainnet address in storage would be applied on every
 * launch, which is a ready impersonation trick. But that left the
 * user with no way to point Ethereum at their own node — the only
 * way not to disclose their addresses to a third-party operator.
 *
 * User addresses are stored SEPARATELY from network config and only
 * supplement it. Built-in network config stays immutable; it cannot
 * be swapped through this path: remove the user address and the
 * wallet returns to the built-in list.
 *
 * WHY IT IS ENCRYPTED. An own-node URL is credentials. The user will
 * paste a string like `https://…/v2/<key>` from their provider
 * account, and often a home-node address that itself reveals
 * location. Storing that string in the clear is the same as storing
 * a password in the clear.
 *
 * NODE AUTHENTICITY IS NOT CHECKED HERE. The source only stores and
 * returns addresses; verifying `eth_chainId` needs a connection and
 * is done in `RpcManager` before persist. The split is deliberate:
 * otherwise storage would depend on transport.
 */
export class CustomRpcProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Custom
  readonly name = PROVIDER_NAME

  readonly #storage: ISecureStorage

  /* Addresses stay in memory: rotation runs on every connect, and
     decrypting on every network call is not allowed. Storage is
     read once in `init()` and written on changes. */
  readonly #endpoints = new Map<ChainId, readonly string[]>()

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  /** Loads saved addresses. Called when a session opens. */
  async init(networks: readonly INetworkConfig[]): Promise<void> {
    this.#endpoints.clear()

    for (const network of networks) {
      const stored = await this.#storage.get<readonly string[]>(
        STORAGE_NAMESPACE.RpcEndpoints,
        endpointsKey(network.chainId),
      )

      if (stored !== null && stored.length > 0) {
        this.#endpoints.set(network.chainId, stored)
      }
    }
  }

  supports(chainId: ChainId): boolean {
    return (this.#endpoints.get(chainId)?.length ?? 0) > 0
  }

  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    return (this.#endpoints.get(network.chainId) ?? []).map((url) => ({
      url,
      providerId: this.id,
      providerName: this.name,
    }))
  }

  /** Network addresses as strings. `RpcManager` needs this to check duplicates. */
  listUrls(chainId: ChainId): readonly string[] {
    return this.#endpoints.get(chainId) ?? []
  }

  /**
   * Adds an address.
   *
   * Only format is checked: the scheme must be `https` or `wss`.
   * Node authenticity is checked by `RpcManager` before this method.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError, InvalidArgumentError
   */
  async add(chainId: ChainId, url: string): Promise<void> {
    assertValidRpcUrl(url)

    const existing = this.listUrls(chainId)

    if (existing.includes(url)) {
      throw new InvalidArgumentError(
        'rpcUrl',
        'this endpoint has already been added for this network',
      )
    }

    if (existing.length >= MAX_ENDPOINTS_PER_NETWORK) {
      throw new InvalidArgumentError(
        'rpcUrl',
        `at most ${String(MAX_ENDPOINTS_PER_NETWORK)} endpoints are allowed per network`,
      )
    }

    await this.#persist(chainId, [...existing, url])
  }

  /** Removes an address. A missing address is not an error. */
  async remove(chainId: ChainId, url: string): Promise<void> {
    const remaining = this.listUrls(chainId).filter((candidate) => candidate !== url)

    await this.#persist(chainId, remaining)
  }

  async #persist(chainId: ChainId, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) {
      this.#endpoints.delete(chainId)
      await this.#storage.remove(STORAGE_NAMESPACE.RpcEndpoints, endpointsKey(chainId))

      return
    }

    this.#endpoints.set(chainId, urls)
    await this.#storage.set(STORAGE_NAMESPACE.RpcEndpoints, endpointsKey(chainId), urls)
  }
}

function endpointsKey(chainId: ChainId): StorageKey {
  return toStorageKey(`rpc.custom.${chainId.toString()}`)
}
