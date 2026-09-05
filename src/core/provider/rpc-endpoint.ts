import type { INetworkConfig } from '@/core/network'
import type { ChainId } from '@/core/types'

/**
 * Known RPC-address sources.
 *
 * The id ends up in the log and in the diagnostics UI: the user must
 * see whose node the wallet is talking to. "It works" and "it works
 * through Alchemy" are different statements for privacy.
 */
export const RPC_PROVIDER_ID = {
  /** Addresses the user added by hand. */
  Custom: 'custom',
  /** Managed Alchemy nodes. Require an API key. */
  Alchemy: 'alchemy',
  /** Public nodes from network config. No key required. */
  Public: 'public',
} as const

export type RpcProviderId = (typeof RPC_PROVIDER_ID)[keyof typeof RPC_PROVIDER_ID]

/**
 * One RPC-node address with its origin.
 *
 * WHY NOT JUST A STRING. Rotation and diagnostics need to know where
 * the address came from: a public-node failure is routine, a failure
 * of an address the user typed must be reported to them, because only
 * they can fix it.
 */
export interface IRpcEndpoint {
  readonly url: string
  readonly providerId: RpcProviderId

  /** Display name of the source. */
  readonly providerName: string
}

/**
 * Source of RPC addresses for a network.
 *
 * THIS IS NOT TRANSPORT. Transport is one — `RpcClient` over JSON-RPC.
 * Alchemy, the user's own node, and a public node speak the same
 * protocol and differ only in how the address was obtained and what
 * conditions it has: key, quota, trust.
 *
 * A separate transport class per source would mean a copy of the
 * JSON-RPC implementation per operator — and a bug fixed in one copy
 * of three.
 */
export interface IRpcProvider {
  readonly id: RpcProviderId
  readonly name: string

  /**
   * Whether the source serves the given network.
   *
   * Alchemy answers `false` for a network outside its list and when
   * there is no key. `false` is a normal state, not an error: rotation
   * simply moves to the next source.
   */
  supports(chainId: ChainId): boolean

  /**
   * Node addresses for the network, in the source's preference order.
   *
   * An empty list is allowed and means the same as `supports === false`.
   */
  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[]
}

/** Result of checking one address. */
export interface IRpcEndpointHealth {
  readonly endpoint: IRpcEndpoint

  /** The node answered and serves the expected network. */
  readonly isHealthy: boolean

  /**
   * Response time in milliseconds. `null` if there was no response.
   *
   * Measured from the start of connect to receiving the block number,
   * so it includes establishing the connection. That is what the user
   * will feel.
   */
  readonly latencyMs: number | null

  /** Failure reason. `null` for a healthy node. */
  readonly reason: string | null

  /**
   * The node serves another network.
   *
   * Separated from other failures on purpose: an unreachable node is
   * an inconvenience, a node with a foreign chainId is either a
   * misconfiguration or an impersonation attempt. The second needs
   * the user's attention, the first does not.
   */
  readonly isChainMismatch: boolean
}
