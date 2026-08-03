import { toChainId } from '@/core/types'

import type { INetworkConfig } from './types'

/**
 * Встроенные сети.
 *
 * ВАЖНО ПРО ПУБЛИЧНЫЕ RPC-УЗЛЫ.
 *
 * Перечисленные ниже эндпоинты общедоступны и не требуют ключа API.
 * Это удобно, но означает конкретный компромисс приватности: оператор узла
 * видит IP-адрес пользователя и все его запросы — какие адреса проверяются,
 * какие контракты вызываются и когда. Этого достаточно, чтобы связать
 * личность с портфелем.
 *
 * Меры, принятые здесь:
 * - у каждой сети несколько независимых операторов узлов, что даёт
 *   и отказоустойчивость, и возможность выбора;
 * - все адреса — строго `https`.
 *
 * Мера, обязательная в дальнейшем: возможность указать собственный
 * RPC-адрес. До её появления приватность запросов не обеспечена.
 *
 * ПРО КОМИССИИ НА L2 (Arbitrum, Optimism, Base).
 *
 * Итоговая стоимость транзакции в этих сетях складывается из платы
 * за исполнение на L2 и платы за публикацию данных на L1. Стандартный
 * `eth_estimateGas` вторую составляющую НЕ учитывает. Расчёт комиссии,
 * опирающийся только на него, занизит стоимость. Учесть обязательно
 * на этапе транзакций.
 */

/** Идентификаторы встроенных сетей. Вынесены отдельно для читаемости ссылок. */
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
 * ПОРЯДОК УЗЛОВ ЗАДАН ИЗМЕРЕНИЕМ, А НЕ ПРЕДПОЧТЕНИЕМ.
 *
 * Кошельку нужны от узла две разные вещи: чтение состояния (баланс,
 * газ, вызовы) и выборка журналов (`eth_getLogs`) — без второй не
 * работает история переводов. Публичные узлы почти всегда умеют первое
 * и почти никогда второе, поэтому список отсортирован по журналам.
 *
 * Проверено обращением к живым узлам 3 августа 2026, окно 10 000 блоков
 * с фильтром по адресу — ровно так, как запрашивает кошелёк:
 *
 * | Сеть      | `eth_getLogs` у первого узла         |
 * | --------- | ------------------------------------ |
 * | Ethereum  | работает                             |
 * | Optimism  | работает                             |
 * | Base      | работает                             |
 * | Avalanche | работает                             |
 * | Polygon   | отказ: бесплатный доступ не отдаёт   |
 * | Arbitrum  | временный отказ узла                 |
 * | BNB Chain | не ответил: предел частоты запросов  |
 *
 * ЧТО УБРАНО. `eth.llamarpc.com` и `cloudflare-eth.com` не отвечают
 * из браузера вовсе — первый обрывает соединение, второй отказывает
 * даже в номере блока. Держать в списке мёртвые адреса значит тратить
 * время пользователя на перебор, который заведомо не даст результата.
 *
 * ЭТО НЕ ЗАМЕНА СВОЕМУ УЗЛУ. Публичный узел видит IP и все адреса,
 * чьи балансы запрашиваются, а его пределы меняются без предупреждения.
 * Владелец, которому история нужна во всех сетях, указывает собственный
 * адрес в настройках.
 */
const ETHEREUM: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Ethereum,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    /* Первым идёт узел, у которого работает выборка журналов: без неё
       кошелёк не показывает историю переводов. Проверено обращением
       к живым узлам — см. пояснение к списку ниже. */
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
 * `supportsEip1559: false` — сознательное решение, а не упущение.
 * Сеть формально принимает транзакции второго типа, но базовая комиссия
 * в ней фактически фиксирована, а приоритетная надбавка не влияет
 * на скорость включения в блок. Показывать пользователю выбор из трёх
 * уровней срочности, ни на что не влияющих, — обман интерфейса.
 */
const BNB_CHAIN: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.BnbChain,
  name: 'BNB Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: [
    'https://bsc.drpc.org',
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.bnbchain.org',
  ],
  blockExplorerUrls: ['https://bscscan.com'],
  isTestnet: false,
  isBuiltIn: true,
  supportsEip1559: false,
}

/**
 * Polygon PoS.
 *
 * Нативная валюта — POL, а не MATIC. Переименование состоялось
 * в сентябре 2024 года; символ MATIC в интерфейсе кошелька устарел.
 */
const POLYGON: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Polygon,
  name: 'Polygon',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrls: [
    'https://polygon.drpc.org',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-rpc.com',
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
  rpcUrls: ['https://base.drpc.org', 'https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
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
 * Полный перечень встроенных сетей в порядке отображения.
 *
 * Порядок значим: Ethereum первым как основная сеть, далее — по убыванию
 * распространённости. Пользователь не может изменить этот порядок,
 * поскольку встроенные сети неизменяемы.
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

/** Сеть, активная при первом запуске приложения. */
export const DEFAULT_CHAIN_ID = BUILT_IN_CHAIN_ID.Ethereum
