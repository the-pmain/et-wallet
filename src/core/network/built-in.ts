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
 * ПРЕЖНЯЯ ТАБЛИЦА ПРОТУХЛА ЗА ДВОЕ СУТОК. Замер 3 августа 2026 говорил,
 * что первый узел Ethereum журналы отдаёт; 5 августа он отвечал «500»,
 * а затем «не могу направить запрос подходящему провайдеру». Пределы
 * бесплатного доступа меняются без предупреждения, и это свойство
 * такого списка, а не случайность: его придётся перемерять.
 *
 * Замер 5 августа 2026, окно 10 000 блоков с фильтром по адресу
 * владельца и без фильтра по контракту — ровно так, как запрашивает
 * история:
 *
 * | Узел                             | `eth_getLogs`                    |
 * | -------------------------------- | -------------------------------- |
 * | gateway.tenderly.co (6 сетей)    | работает, 50 000 блоков за 0,2 с |
 * | eth.drpc.org                     | «500», затем отказ маршрутизации |
 * | *-rpc.publicnode.com             | «403: нужен архивный токен»      |
 * | polygon.drpc.org                 | «диапазоны свыше 10 000 блоков»  |
 * | bsc-dataseed.bnbchain.org        | «limit exceeded»                 |
 * | 1rpc.io                          | предел 50 блоков                 |
 * | rpc.ankr.com                     | требует учётной записи           |
 * | bsc.rpc.blxrbdn.com              | работает                         |
 *
 * ПОЧЕМУ ШЛЮЗЫ TENDERLY СТОЯТ ПЕРВЫМИ. Они единственные из проверенных
 * отдают журналы бесплатно и при этом отвечают на весь набор методов,
 * нужный кошельку: баланс, nonce, вызов, оценка газа, приоритетная
 * надбавка. Проверено по каждой из шести сетей отдельно, а не по одной
 * с распространением вывода на остальные.
 *
 * ПОЧЕМУ У BNB ЖУРНАЛЬНЫЙ УЗЕЛ СТОИТ ПОСЛЕДНИМ, А НЕ ПЕРВЫМ.
 * `bsc.rpc.blxrbdn.com` — шлюз компании, работающей с приватным потоком
 * сделок. Журналы он отдаёт, но как именно он публикует транзакции,
 * не проверено, а первый узел списка обслуживает и отправку. Менять
 * способ публикации транзакции ради истории недопустимо: это разные
 * по цене вещи. Стоя последним, он достаётся только выборке журналов —
 * `FailoverProvider.getLogs` опрашивает остальные адреса, не меняя
 * действующий узел.
 *
 * По той же причине НЕ добавлен `rpc.mevblocker.io`: журналы отдаёт,
 * но это релей приватного потока сделок, и в списке Ethereum он мог бы
 * стать действующим узлом.
 *
 * ЧТО УБРАНО. `eth.llamarpc.com`, `cloudflare-eth.com` и `eth.merkle.io`
 * не отвечают из браузера вовсе, а `polygon-rpc.com` отказывает даже
 * в номере блока: «API key disabled, tenant disabled». Держать в списке
 * мёртвые адреса значит тратить время пользователя на перебор, который
 * заведомо не даст результата.
 *
 * ЭТО НЕ ЗАМЕНА СВОЕМУ УЗЛУ. Публичный узел видит IP и все адреса,
 * чьи балансы запрашиваются, а его пределы меняются без предупреждения —
 * см. выше. Владелец, которому история нужна надёжно, указывает
 * собственный адрес в настройках.
 */
const ETHEREUM: INetworkConfig = {
  chainId: BUILT_IN_CHAIN_ID.Ethereum,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    /* Первым идёт узел, у которого работает выборка журналов: без неё
       кошелёк не показывает историю переводов. Проверено обращением
       к живым узлам — см. пояснение к списку выше. */
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
    /* Последним намеренно — см. пояснение к списку выше. */
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
 * Нативная валюта — POL, а не MATIC. Переименование состоялось
 * в сентябре 2024 года; символ MATIC в интерфейсе кошелька устарел.
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
