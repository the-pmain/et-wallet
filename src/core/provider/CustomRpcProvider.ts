import type { ISecureStorage } from '@/core/encryption'
import { InvalidArgumentError } from '@/core/errors'
import { assertValidRpcUrl, type INetworkConfig } from '@/core/network'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import type { ChainId } from '@/core/types'

import { RPC_PROVIDER_ID, type IRpcEndpoint, type IRpcProvider } from './rpc-endpoint'

const PROVIDER_NAME = 'Собственный узел'

/**
 * Предел числа адресов на сеть.
 *
 * Ограничение против засорения хранилища и против бесконечного перебора
 * при подключении: каждый неотвечающий адрес добавляет задержку.
 */
const MAX_ENDPOINTS_PER_NETWORK = 8

/**
 * Адреса RPC, добавленные пользователем.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ. Встроенные сети намеренно неизменяемы: перезаписанный
 * в хранилище адрес основной сети применялся бы при каждом запуске, и это
 * готовый приём подмены. Но из-за этого у пользователя не было способа
 * указать собственный узел для Ethereum — то есть единственного способа
 * не раскрывать свои адреса стороннему оператору.
 *
 * Здесь пользовательские адреса хранятся ОТДЕЛЬНО от конфигурации сети
 * и лишь дополняют её. Конфигурация встроенной сети остаётся неизменяемой,
 * подменить её через этот путь нельзя: убрав пользовательский адрес,
 * кошелёк возвращается к встроенному списку.
 *
 * ПОЧЕМУ ШИФРУЕТСЯ. Адрес собственного узла — это учётные данные.
 * Пользователь вставит сюда строку вида `https://…/v2/<ключ>` от своей
 * учётной записи у провайдера, а часто и адрес домашнего узла, который
 * сам по себе раскрывает местоположение. Открытое хранение такой строки
 * равносильно хранению пароля открытым текстом.
 *
 * ПРОВЕРКА ПОДЛИННОСТИ УЗЛА ЗДЕСЬ НЕ ВЫПОЛНЯЕТСЯ. Источник умеет только
 * хранить и отдавать адреса; сверка `eth_chainId` требует соединения
 * и выполняется в `RpcManager` до сохранения. Разделение намеренное:
 * иначе хранилище зависело бы от транспорта.
 */
export class CustomRpcProvider implements IRpcProvider {
  readonly id = RPC_PROVIDER_ID.Custom
  readonly name = PROVIDER_NAME

  readonly #storage: ISecureStorage

  /* Адреса держатся в памяти: перебор выполняется при каждом подключении,
     а расшифровка на каждое обращение к сети недопустима. Хранилище
     читается один раз при `init()` и пишется при изменениях. */
  readonly #endpoints = new Map<ChainId, readonly string[]>()

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  /** Загружает сохранённые адреса. Вызывается при открытии сессии. */
  async init(networks: readonly INetworkConfig[]): Promise<void> {
    this.#endpoints.clear()

    for (const network of networks) {
      const stored = await this.#storage.get<readonly string[]>(
        STORAGE_NAMESPACE.RpcEndpoints,
        endpointsKey(network.chainId),
      )

      if (stored !== null && stored.length > 0) {
        this.#endpoints.set(network.chainId, stored)
      }
    }
  }

  supports(chainId: ChainId): boolean {
    return (this.#endpoints.get(chainId)?.length ?? 0) > 0
  }

  listEndpoints(network: INetworkConfig): readonly IRpcEndpoint[] {
    return (this.#endpoints.get(network.chainId) ?? []).map((url) => ({
      url,
      providerId: this.id,
      providerName: this.name,
    }))
  }

  /** Адреса сети в виде строк. Нужен `RpcManager` для проверки повторов. */
  listUrls(chainId: ChainId): readonly string[] {
    return this.#endpoints.get(chainId) ?? []
  }

  /**
   * Добавляет адрес.
   *
   * Проверяется только формат: схема обязана быть `https` либо `wss`.
   * Подлинность узла проверяет `RpcManager` до вызова этого метода.
   *
   * @throws InvalidRpcUrlError, InsecureRpcUrlError, InvalidArgumentError
   */
  async add(chainId: ChainId, url: string): Promise<void> {
    assertValidRpcUrl(url)

    const existing = this.listUrls(chainId)

    if (existing.includes(url)) {
      throw new InvalidArgumentError('rpcUrl', 'этот адрес уже добавлен для данной сети')
    }

    if (existing.length >= MAX_ENDPOINTS_PER_NETWORK) {
      throw new InvalidArgumentError(
        'rpcUrl',
        `для одной сети допускается не более ${String(MAX_ENDPOINTS_PER_NETWORK)} адресов`,
      )
    }

    await this.#persist(chainId, [...existing, url])
  }

  /** Удаляет адрес. Отсутствующий адрес — не ошибка. */
  async remove(chainId: ChainId, url: string): Promise<void> {
    const remaining = this.listUrls(chainId).filter((candidate) => candidate !== url)

    await this.#persist(chainId, remaining)
  }

  async #persist(chainId: ChainId, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) {
      this.#endpoints.delete(chainId)
      await this.#storage.remove(STORAGE_NAMESPACE.RpcEndpoints, endpointsKey(chainId))

      return
    }

    this.#endpoints.set(chainId, urls)
    await this.#storage.set(STORAGE_NAMESPACE.RpcEndpoints, endpointsKey(chainId), urls)
  }
}

function endpointsKey(chainId: ChainId): StorageKey {
  return toStorageKey(`rpc.custom.${chainId.toString()}`)
}
