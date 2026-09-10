import type { INetworkConfig } from '@/core/network'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Public node'

/**
 * Публичные адреса из конфигурации сети.
 *
 * ЗАЧЕМ НУЖЕН ОТДЕЛЬНЫЙ ИСТОЧНИК ДЛЯ ТОГО, ЧТО УЖЕ ЛЕЖИТ В КОНФИГУРАЦИИ.
 * Перебор обязан быть однородным: если публичные адреса подмешивались бы
 * в обход общего механизма, они не получили бы ни отметки происхождения,
 * ни участия в проверке доступности, ни места в порядке предпочтения.
 *
 * Второе назначение — работоспособность без ключа. Alchemy без ключа
 * не даёт ни одного адреса, и без этого источника кошелёк не подключился
 * бы никуда вообще.
 *
 * ПРИВАТНОСТЬ. Оператор публичного узла видит IP-адрес пользователя
 * и все его запросы. Несколько независимых операторов на сеть — смягчение,
 * а не решение: полное решение это собственный узел (см. `CustomRpcProvider`).
 */
export class PublicRpcProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Public
  readonly name = PROVIDER_NAME

  supports(_chainId: ChainId): boolean {
    /* Наличие адресов проверяется по самой конфигурации сети: список
       различается от сети к сети, и заранее он неизвестен. */
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
