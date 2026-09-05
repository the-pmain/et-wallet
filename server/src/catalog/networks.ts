import type { INetworkEntry } from './types.ts'

/**
 * Network catalog.
 *
 * THE SET MATCHES THE EXTENSION'S BUILT-IN LIST. The service here is
 * an update source, not the only source of truth: the wallet must
 * work offline on its own built-in list. A catalog that became
 * required would turn a server outage into a dead wallet.
 *
 * THE WALLET STILL CHECKS THE NETWORK ID WITH THE NODE. The value
 * from here is a claim, not proof: a node serving another chain is
 * found only by asking it.
 */
export const NETWORKS: readonly INetworkEntry[] = [
  {
    chainId: 1n,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
    isTestnet: false,
    supportsEip1559: true,
  },
  {
    chainId: 56n,
    name: 'BNB Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrls: ['https://bscscan.com'],
    isTestnet: false,
    /* The network accepts type-2 transactions, but its base fee is
       effectively fixed and the priority tip does not change inclusion
       speed. An urgency picker that does nothing is a UI lie. */
    supportsEip1559: false,
  },
  {
    chainId: 137n,
    name: 'Polygon',
    /* Native currency is POL, not MATIC: the rename happened in
       September 2024. */
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
    isTestnet: false,
    supportsEip1559: true,
  },
  {
    chainId: 42161n,
    name: 'Arbitrum One',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://arbiscan.io'],
    isTestnet: false,
    supportsEip1559: true,
  },
  {
    chainId: 10n,
    name: 'OP Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
    isTestnet: false,
    supportsEip1559: true,
  },
  {
    chainId: 8453n,
    name: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
    isTestnet: false,
    supportsEip1559: true,
  },
  {
    chainId: 43114n,
    name: 'Avalanche C-Chain',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://snowtrace.io'],
    isTestnet: false,
    supportsEip1559: true,
  },
]
