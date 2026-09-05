import type { INetworkConfig } from '@/core/network'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Public node'

/**
 * Public addresses from network config.
 *
 * WHY A SEPARATE SOURCE FOR WHAT ALREADY LIVES IN CONFIG.
 * Rotation must be uniform: if public addresses were mixed in
 * outside the shared mechanism, they would get neither an origin
 * mark, nor a place in the health check, nor a place in preference
 * order.
 *
 * Second purpose — working without a key. Alchemy with no key gives
 * no addresses, and without this source the wallet would connect
 * nowhere at all.
 *
 * PRIVACY. A public-node operator sees the user's IP and every
 * request. Several independent operators per network is mitigation,
 * not a solution: the full solution is an own node (see
 * `CustomRpcProvider`).
 */
export class PublicRpcProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Public
  readonly name = PROVIDER_NAME

  supports(_chainId: ChainId): boolean {
    /* Whether addresses exist is checked on the network config
       itself: the list differs per network and is not known ahead. */
    return true
  }

  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    return network.rpcUrls.map((url) => ({
      url,
      providerId: this.id,
      providerName: this.name,
    }))
  }
}
