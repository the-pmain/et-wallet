import { BUILT_IN_CHAIN_ID, type INetworkConfig } from '@/core/network'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Alchemy'

/** Base domain of the managed nodes. */
const ALCHEMY_HOST = 'g.alchemy.com'

/**
 * Alchemy subdomains by network id.
 *
 * The list is explicit, not derived from the network name: names come
 * from config, subdomains from the operator, and a match between them
 * is accidental. A network missing here is simply served by another
 * source.
 */
const ALCHEMY_SUBDOMAIN: ReadonlyMap<ChainId, string> = new Map([
  [BUILT_IN_CHAIN_ID.Ethereum, 'eth-mainnet'],
  [BUILT_IN_CHAIN_ID.Optimism, 'opt-mainnet'],
  [BUILT_IN_CHAIN_ID.BnbChain, 'bnb-mainnet'],
  [BUILT_IN_CHAIN_ID.Polygon, 'polygon-mainnet'],
  [BUILT_IN_CHAIN_ID.Base, 'base-mainnet'],
  [BUILT_IN_CHAIN_ID.Arbitrum, 'arb-mainnet'],
  [BUILT_IN_CHAIN_ID.Avalanche, 'avax-mainnet'],
])

/** Source settings. */
export interface IAlchemyProviderOptions {
  /**
   * API key.
   *
   * An empty string or `null` means the source is off: it will give
   * no addresses, and rotation will move to the next source.
   */
  readonly apiKey: string | null
}

/**
 * Managed Alchemy nodes.
 *
 * ABOUT A KEY IN A CLIENT APP. A key that landed in the bundle is
 * public by definition: anyone who opens page sources or looks at
 * network requests can see it. That is not an implementation slip,
 * it is a property of client apps in general.
 *
 * Two requirements follow for the key owner:
 * 1. Restrict the key to the app domain in the Alchemy panel. Without
 *    that restriction strangers will use the key and the quota will
 *    run out.
 * 2. Do not grant the key privileges beyond reading the chain.
 *
 * ABOUT PRIVACY. One operator serving every wallet request sees the
 * user's IP and every address whose balance is queried. That is
 * enough to tie a person to a portfolio and to build a graph of
 * links between one owner's addresses. Public nodes give the same,
 * but at least the requests are spread across several independent
 * operators.
 *
 * The only real solution is an own node, see `CustomRpcProvider`.
 */
export class AlchemyProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Alchemy
  readonly name = PROVIDER_NAME

  readonly #apiKey: string | null

  constructor(options: IAlchemyProviderOptions) {
    /* An empty string is treated as no key: an env variable that is
       declared and left blank arrives exactly that way, and without
       this normalization the source would emit addresses with an
       empty key. */
    this.#apiKey = options.apiKey === null || options.apiKey === '' ? null : options.apiKey
  }

  /** Whether the source is configured. Useful to the settings UI. */
  get isConfigured(): boolean {
    return this.#apiKey !== null
  }

  supports(chainId: ChainId): boolean {
    return this.#apiKey !== null && ALCHEMY_SUBDOMAIN.has(chainId)
  }

  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    const subdomain = ALCHEMY_SUBDOMAIN.get(network.chainId)

    if (this.#apiKey === null || subdomain === undefined) {
      return []
    }

    return [
      {
        url: `https://${subdomain}.${ALCHEMY_HOST}/v2/${this.#apiKey}`,
        providerId: this.id,
        providerName: this.name,
      },
    ]
  }
}
