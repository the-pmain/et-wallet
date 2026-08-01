import type { INetworkEntry } from './types.ts'

/**
 * Каталог сетей.
 *
 * СОСТАВ СОВПАДАЕТ СО ВСТРОЕННЫМ СПИСКОМ РАСШИРЕНИЯ. Сервис здесь —
 * источник обновлений, а не единственный источник истины: кошелёк обязан
 * работать и без сети, опираясь на собственный встроенный список.
 * Каталог, ставший обязательным, превратил бы отказ сервера
 * в неработающий кошелёк.
 *
 * ИДЕНТИФИКАТОР СЕТИ КОШЕЛЁК ВСЁ РАВНО СВЕРЯЕТ С УЗЛОМ. Значение
 * отсюда — заявление, а не доказательство: узел, обслуживающий другую
 * цепь, обнаруживается только опросом.
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
    /* Сеть принимает транзакции второго типа, но базовая комиссия в ней
       фактически фиксирована, а приоритетная надбавка не влияет на скорость
       включения. Выбор срочности, ни на что не влияющий, — обман интерфейса. */
    supportsEip1559: false,
  },
  {
    chainId: 137n,
    name: 'Polygon',
    /* Нативная валюта — POL, а не MATIC: переименование состоялось
       в сентябре 2024 года. */
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
