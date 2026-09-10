import type { ChainId } from '@/core/types'

/** Native currency of a network. */
export interface INativeCurrency {
  readonly name: string
  readonly symbol: string

  /**
   * Number of decimal places. For Ethereum — 18.
   *
   * Stored in configuration, not taken as a constant: networks
   * with a different count exist, and a hard-coded 18 would show
   * an amount off from the real one by orders of magnitude.
   */
  readonly decimals: number
}

/**
 * Blockchain network configuration.
 *
 * This is DATA: serializable, stored, editable by the user.
 * A live connection to a node is `IProvider` — see the note on
 * the split of concepts in its file.
 */
export interface INetworkConfig {
  readonly chainId: ChainId

  readonly name: string

  readonly nativeCurrency: INativeCurrency

  /**
   * RPC node addresses in priority order.
   *
   * A list, not a single value: a node can be down, and switching
   * to a fallback must not require the user to intervene.
   *
   * SECURITY REQUIREMENT: only `https:` and `wss:` schemes are
   * allowed. Plain HTTP lets a middleman substitute the balance,
   * nonce, gas price, and contract call result — the user will
   * sign a transaction different from the one shown. The check
   * runs when a network is added and yields `InsecureRpcUrlError`.
   */
  readonly rpcUrls: readonly string[]

  /** Block-explorer addresses for building transaction links. */
  readonly blockExplorerUrls: readonly string[]

  /**
   * Test network.
   *
   * Affects more than styling: operations on a test network must
   * not count toward the portfolio total, or the user will see
   * funds that do not exist.
   */
  readonly isTestnet: boolean

  /**
   * Built-in network.
   *
   * Built-in networks cannot be removed, and their chainId and
   * RPC are not user-editable. That is the defence against
   * substituting main-network parameters through the add-network
   * UI — a phishing technique.
   */
  readonly isBuiltIn: boolean

  readonly supportsEip1559: boolean
}

/** Parameters for adding a user network. */
export interface IAddNetworkParams {
  readonly chainId: ChainId
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly rpcUrls: readonly string[]
  readonly blockExplorerUrls?: readonly string[]
  readonly isTestnet?: boolean

  /**
   * Consent to add a network whose name matches a built-in one.
   *
   * A separate flag, not a silent allow: a name match is the main
   * network-impersonation trick, and adding must require a
   * deliberate confirmation. The default `false` means a reject
   * with `NetworkImpersonationError`, which the UI must show
   * before a retry.
   */
  readonly allowImpersonation?: boolean
}

/** Network-layer events. */
export interface NetworkEventMap {
  'network:changed': { readonly chainId: ChainId }
  'network:listChanged': { readonly chainIds: readonly ChainId[] }
}
