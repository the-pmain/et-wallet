import type { IRpcEntry } from './types.ts'

/**
 * Recommended RPC catalog.
 *
 * WHAT "RECOMMENDED" MEANS. The URL serves the claimed network and is
 * reachable from the browser. It promises nothing about privacy: a
 * public-node operator sees the user's IP and every request — which
 * addresses are checked, which contracts are called, and when. That
 * is enough to link an identity to a portfolio.
 *
 * So each record carries the operator name and a public flag:
 * "it works" and "it works through a third-party operator who sees
 * all your addresses" are different claims, and only the user may
 * choose between them.
 *
 * NODES THAT NEED A KEY ARE NOT LISTED. A key given to every user
 * stops being a key, and a service that hands out someone else's
 * keys takes on their limits and their liability.
 */
export const RPC_ENDPOINTS: readonly IRpcEntry[] = [
  {
    chainId: 1n,
    url: 'https://ethereum-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 1n, url: 'https://eth.llamarpc.com', operator: 'LlamaNodes', isPublic: true },
  { chainId: 1n, url: 'https://cloudflare-eth.com', operator: 'Cloudflare', isPublic: true },

  { chainId: 56n, url: 'https://bsc-rpc.publicnode.com', operator: 'PublicNode', isPublic: true },
  {
    chainId: 56n,
    url: 'https://bsc-dataseed.bnbchain.org',
    operator: 'BNB Chain',
    isPublic: true,
  },

  {
    chainId: 137n,
    url: 'https://polygon-bor-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 137n, url: 'https://polygon-rpc.com', operator: 'Polygon Labs', isPublic: true },

  {
    chainId: 42161n,
    url: 'https://arbitrum-one-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  {
    chainId: 42161n,
    url: 'https://arb1.arbitrum.io/rpc',
    operator: 'Offchain Labs',
    isPublic: true,
  },

  {
    chainId: 10n,
    url: 'https://optimism-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 10n, url: 'https://mainnet.optimism.io', operator: 'OP Labs', isPublic: true },

  {
    chainId: 8453n,
    url: 'https://base-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  { chainId: 8453n, url: 'https://mainnet.base.org', operator: 'Base', isPublic: true },

  {
    chainId: 43114n,
    url: 'https://avalanche-c-chain-rpc.publicnode.com',
    operator: 'PublicNode',
    isPublic: true,
  },
  {
    chainId: 43114n,
    url: 'https://api.avax.network/ext/bc/C/rpc',
    operator: 'Ava Labs',
    isPublic: true,
  },
]
