import type {
  INetworkResponse,
  INotificationResponse,
  IRpcEndpointResponse,
  ITokenResponse,
  IVersionResponse,
} from '../api/contracts.ts'
import { compareVersions } from '../lib/version.ts'

import { NETWORKS } from './networks.ts'
import { NOTIFICATIONS } from './notifications.ts'
import { RELEASES } from './releases.ts'
import { RPC_ENDPOINTS } from './rpc.ts'
import { TOKENS } from './tokens.ts'
import type {
  INetworkEntry,
  INotificationEntry,
  IReleaseCatalog,
  IRpcEntry,
  ITokenEntry,
} from './types.ts'
import {
  validateNetworks,
  validateNotifications,
  validateReleases,
  validateRpcEndpoints,
  validateTokens,
} from './validate.ts'

/** Catalog contents. Injected so a test can supply its own. */
export interface ICatalogData {
  readonly networks: readonly INetworkEntry[]
  readonly rpcEndpoints: readonly IRpcEntry[]
  readonly tokens: readonly ITokenEntry[]
  readonly notifications: readonly INotificationEntry[]
  readonly releases: IReleaseCatalog
}

/** Catalog from the repository. */
export const REPOSITORY_CATALOG: ICatalogData = {
  networks: NETWORKS,
  rpcEndpoints: RPC_ENDPOINTS,
  tokens: TOKENS,
  notifications: NOTIFICATIONS,
  releases: RELEASES,
}

/**
 * Catalog access.
 *
 * VALIDATION RUNS IN THE CONSTRUCTOR, NOT ON THE FIRST REQUEST.
 * A service with a corrupt catalog must not start: a startup refusal
 * is seen by whoever deploys the service; an error in the response
 * is seen by nobody until it is too late.
 *
 * DATA IS IMMUTABLE AT RUNTIME. Changing the catalog is a new service
 * release, not a database write: a contract-address edit must go
 * through review and history.
 */
export class CatalogService {
  readonly #data: ICatalogData
  readonly #knownChains: ReadonlySet<bigint>

  constructor(data: ICatalogData = REPOSITORY_CATALOG) {
    const knownChains = validateNetworks(data.networks)

    validateRpcEndpoints(data.rpcEndpoints, knownChains)
    validateTokens(data.tokens, knownChains)
    validateNotifications(data.notifications)
    validateReleases(data.releases)

    this.#data = data
    this.#knownChains = knownChains
  }

  hasNetwork(chainId: bigint): boolean {
    return this.#knownChains.has(chainId)
  }

  listNetworks(): readonly INetworkResponse[] {
    return this.#data.networks.map((entry) => ({
      chainId: entry.chainId.toString(),
      name: entry.name,
      nativeCurrency: entry.nativeCurrency,
      blockExplorerUrls: entry.blockExplorerUrls,
      isTestnet: entry.isTestnet,
      supportsEip1559: entry.supportsEip1559,
    }))
  }

  listRpcEndpoints(chainId: bigint): readonly IRpcEndpointResponse[] {
    return this.#data.rpcEndpoints
      .filter((entry) => entry.chainId === chainId)
      .map((entry) => ({ url: entry.url, operator: entry.operator, isPublic: entry.isPublic }))
  }

  /**
   * Recommended tokens for a network.
   *
   * An empty list for a known network means "no confirmed
   * recommendations", not "tokens do not exist". The client must
   * convey that difference: otherwise the user reads emptiness as
   * a claim.
   */
  listTokens(chainId: bigint): readonly ITokenResponse[] {
    return this.#data.tokens
      .filter((entry) => entry.chainId === chainId)
      .map((entry) => ({
        chainId: entry.chainId.toString(),
        address: entry.address,
        symbol: entry.symbol,
        name: entry.name,
        decimals: entry.decimals,
        provenance: entry.provenance,
        verifiedAt: entry.verifiedAt,
      }))
  }

  /**
   * Active notifications.
   *
   * @param now Current instant. Passed in so expiry-boundary behavior
   *        is tested, not observed once in production.
   */
  listNotifications(now: Date): readonly INotificationResponse[] {
    const moment = now.getTime()

    return this.#data.notifications
      .filter((entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > moment)
      .map((entry) => ({
        id: entry.id,
        severity: entry.severity,
        title: entry.title,
        body: entry.body,
        publishedAt: entry.publishedAt,
        expiresAt: entry.expiresAt,
      }))
  }

  /**
   * Client version status.
   *
   * @param clientVersion Version the client asks about. `null` if
   *        unreported: then there is nothing to compare, and flags
   *        stay `null`. "We do not know" must not become "all is well"
   *        or "time to update" — both would be a claim from nothing.
   */
  getVersionStatus(clientVersion: string | null): IVersionResponse {
    const { latest, minSupported, advisory } = this.#data.releases

    if (clientVersion === null) {
      return { latest, minSupported, isSupported: null, isOutdated: null, advisory }
    }

    return {
      latest,
      minSupported,
      isSupported: compareVersions(clientVersion, minSupported) >= 0,
      isOutdated: compareVersions(clientVersion, latest) < 0,
      advisory,
    }
  }
}
