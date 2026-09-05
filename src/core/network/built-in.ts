import { toChainId } from '@/core/types'

import type { INetworkConfig } from './types'

/**
 * Built-in networks.
 *
 * IMPORTANT ABOUT PUBLIC RPC NODES.
 *
 * The endpoints listed below are public and need no API key. That is
 * convenient, but it means a concrete privacy trade-off: the node
 * operator sees the user's IP and every request — which addresses
 * are checked, which contracts are called, and when. That is enough
 * to tie a person to a portfolio.
 *
 * Measures taken here:
 * - each network has several independent node operators, which gives
 *   both failover and a choice;
 * - every URL is strictly `https`.
 *
 * A measure required later: the ability to set an own RPC URL. Until
 * that exists, request privacy is not provided.
 *
 * ABOUT L2 FEES (Arbitrum, Optimism, Base).
 *
 * The total cost of a transaction on those networks is the L2
 * execution fee plus the fee for publishing data on L1. Standard
 * `eth_estimateGas` does NOT include the second part. A fee
 * calculation that relies only on it will understate the cost. That
 * must be accounted for at the transaction stage.
 */

/** Built-in network ids. Extracted so references stay readable. */
export const BUILT_IN_CHAIN_ID = {
  Ethereum: toChainId(1),
  Optimism: toChainId(10),
  BnbChain: toChainId(56),
  Polygon: toChainId(137),
  Base: toChainId(8453),
  Arbitrum: toChainId(42161),
  Avalanche: toChainId(43114),
} as const

/**
 * NODE ORDER COMES FROM MEASUREMENT, NOT PREFERENCE.
 *
 * The wallet needs two different things from a node: reading state
 * (balance, gas, calls) and log queries (`eth_getLogs`) — without
 * the second, transfer history does not work. Public nodes almost
 * always can do the first and almost never the second, so the list
 * is sorted by logs.
 *
 * THE PREVIOUS TABLE WENT STALE IN TWO DAYS. A measurement on
 * 3 August 2026 said the first Ethereum node served logs; on
 * 5 August it answered "500", then "cannot route the request to a
 * suitable provider". Free-tier limits change without notice, and
 * that is a property of such a list, not an accident: it will have
 * to be remeasured.
 *
 * Measurement of 5 August 2026, a 10 000-block window with an owner
 * address filter and no contract filter — exactly how history asks:
 *
 * | Node                             | `eth_getLogs`                    |
 * | -------------------------------- | -------------------------------- |
 * | gateway.tenderly.co (6 networks) | works, 50 000 blocks in 0.2 s    |
 * | eth.drpc.org                     | "500", then a routing refusal    |
 * | *-rpc.publicnode.com             | "403: archive token required"    |
 * | polygon.drpc.org                 | "ranges over 10 000 blocks"      |
 * | bsc-dataseed.bnbchain.org        | "limit exceeded"                 |
 * | 1rpc.io                          | 50-block limit                   |
 * | rpc.ankr.com                     | requires an account              |
 * | bsc.rpc.blxrbdn.com              | works                            |
 *
 * WHY TENDERLY GATEWAYS ARE FIRST. They are the only ones among those
 * checked that serve logs for free and still answer the whole set of
 * methods the wallet needs: balance, nonce, call, gas estimate,
 * priority fee. Checked on each of the six networks separately, not
 * on one with the conclusion spread to the rest.
 *
 * WHY BNB'S LOG NODE IS LAST, NOT FIRST.
 * `bsc.rpc.blxrbdn.com` is a gateway of a company that works with a
 * private transaction stream. It serves logs, but how it publishes
 * transactions is unchecked, and the first node on the list also
 * handles send. Changing how a transaction is published for the sake
 * of history is not allowed: those are different-priced things.
 * Standing last, it is only used for log queries —
 * `FailoverProvider.getLogs` probes the other addresses without
 * changing the active node.
 *
 * For the same reason `rpc.mevblocker.io` is NOT added: it serves
 * logs, but it is a private-stream relay, and on the Ethereum list
 * it could become the active node.
 *
 * WHAT WAS REMOVED. `eth.llamarpc.com`, `cloudflare-eth.com`, and
 * `eth.merkle.io` do not answer from the browser at all, and
 * `polygon-rpc.com` refuses even a block number: "API key disabled,
 * tenant disabled". Keeping dead addresses in the list means
 * spending the user's time on rotation that cannot succeed.
 *
 * THIS IS NOT A REPLACEMENT FOR AN OWN NODE. A public node sees the
 * IP and every address whose balance is queried, and its limits
 * change without notice — see above. An owner who needs history
 * reliably sets their own URL in settings.
 */
const ETHEREUM: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Ethereum,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    /* First is the node whose log query works: without it the wallet
       does not show transfer history. Checked by talking to live
       nodes — see the list explanation above. */
    'https://gateway.tenderly.co/public/mainnet',
    'https://eth.drpc.org',
    'https://ethereum-rpc.publicnode.com',
  ],
  blockExplorerUrls: ['https://etherscan.io'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

/**
 * BNB Smart Chain.
 *
 * `supportsEip1559: false` is a conscious decision, not an omission.
 * The network formally accepts type-2 transactions, but the base fee
 * is effectively fixed and the priority tip does not affect inclusion
 * speed. Showing the user a choice of three urgency levels that
 * affect nothing is a UI lie.
 */
const BNB_CHAIN: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.BnbChain,
  name: 'BNB Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: [
    'https://bsc.drpc.org',
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.bnbchain.org',
    /* Last on purpose — see the list explanation above. */
    'https://bsc.rpc.blxrbdn.com',
  ],
  blockExplorerUrls: ['https://bscscan.com'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: false,
}

/**
 * Polygon PoS.
 *
 * The native currency is POL, not MATIC. The rename happened in
 * September 2024; the MATIC symbol in the wallet UI is obsolete.
 */
const POLYGON: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Polygon,
  name: 'Polygon',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrls: [
    'https://gateway.tenderly.co/public/polygon',
    'https://polygon.drpc.org',
    'https://polygon-bor-rpc.publicnode.com',
  ],
  blockExplorerUrls: ['https://polygonscan.com'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

const ARBITRUM: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Arbitrum,
  name: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    'https://gateway.tenderly.co/public/arbitrum',
    'https://arbitrum.drpc.org',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
  ],
  blockExplorerUrls: ['https://arbiscan.io'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

const OPTIMISM: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Optimism,
  name: 'OP Mainnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    'https://gateway.tenderly.co/public/optimism',
    'https://optimism.drpc.org',
    'https://optimism-rpc.publicnode.com',
    'https://mainnet.optimism.io',
  ],
  blockExplorerUrls: ['https://optimistic.etherscan.io'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

const BASE: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Base,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    'https://gateway.tenderly.co/public/base',
    'https://base.drpc.org',
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
  ],
  blockExplorerUrls: ['https://basescan.org'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

const AVALANCHE: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Avalanche,
  name: 'Avalanche C-Chain',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: [
    'https://gateway.tenderly.co/public/avalanche',
    'https://avalanche.drpc.org',
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://api.avax.network/ext/bc/C/rpc',
  ],
  blockExplorerUrls: ['https://snowtrace.io'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: true,
}

/**
 * Full list of built-in networks in display order.
 *
 * Order matters: Ethereum first as the main network, then by
 * decreasing prevalence. The user cannot change this order, because
 * built-in networks are immutable.
 */
export const BUILT_IN_NETWORKS: readonly INetworkConfig[] = [
  ETHEREUM,
  BNB_CHAIN,
  POLYGON,
  ARBITRUM,
  OPTIMISM,
  BASE,
  AVALANCHE,
]

/** Network that is active on first launch. */
export const DEFAULT_CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
