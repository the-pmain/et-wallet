import { BUILT_IN_CHAIN_ID, type INetworkConfig } from '@/core/network'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Alchemy'

/** Базовый домен управляемых узлов. */
const ALCHEMY_HOST = 'g.alchemy.com'

/**
 * Поддомены Alchemy по идентификатору сети.
 *
 * Список задан явно, а не выводится из имени сети: имена задаёт
 * конфигурация, а поддомены — оператор, и совпадение между ними
 * случайно. Сеть, отсутствующая здесь, просто обслуживается другим
 * источником.
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

/** Настройки источника. */
export interface IAlchemyProviderOptions {
  /**
   * Ключ API.
   *
   * Пустая строка либо `null` означают, что источник выключен: ни одного
   * адреса он не даст, и перебор перейдёт к следующему.
   */
  readonly apiKey: string | null
}

/**
 * Управляемые узлы Alchemy.
 *
 * ПРО КЛЮЧ В КЛИЕНТСКОМ ПРИЛОЖЕНИИ. Ключ, попавший в бандл, публичен
 * по определению: его видит любой, кто откроет исходники страницы либо
 * посмотрит сетевые запросы. Это не недосмотр реализации, а свойство
 * клиентских приложений вообще.
 *
 * Отсюда два обязательных требования к владельцу ключа:
 * 1. Ограничить ключ доменом приложения в панели Alchemy. Без ограничения
 *    ключ будет использован посторонними и квота исчерпается.
 * 2. Не выдавать ключу прав, выходящих за чтение цепи.
 *
 * ПРО ПРИВАТНОСТЬ. Один оператор, обслуживающий все запросы кошелька,
 * видит IP-адрес пользователя и каждый адрес, чей баланс запрашивается.
 * Этого достаточно, чтобы связать личность с портфелем и построить граф
 * связей между адресами одного владельца. Публичные узлы дают то же самое,
 * но запросы хотя бы разнесены между несколькими независимыми операторами.
 *
 * Единственное настоящее решение — собственный узел, см. `CustomRpcProvider`.
 */
export class AlchemyProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Alchemy
  readonly name = PROVIDER_NAME

  readonly #apiKey: string | null

  constructor(options: IAlchemyProviderOptions) {
    /* Пустая строка приравнивается к отсутствию ключа: переменная
       окружения, объявленная и незаполненная, приходит именно так,
       и без этой нормализации источник давал бы адреса с пустым ключом. */
    this.#apiKey = options.apiKey === null || options.apiKey === '' ? null : options.apiKey
  }

  /** Настроен ли источник. Полезно интерфейсу настроек. */
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
