import { SETTINGS_KEY, STORAGE_NAMESPACE, toStorageKey, type IStorageService } from '@/core/storage'
import { toChainId, type ChainId } from '@/core/types'

import type { INetworkRepository } from './contracts'
import type { INativeCurrency, INetworkConfig } from './types'

/**
 * Представление конфигурации сети в хранилище.
 *
 * Отличается от доменной модели одним полем: `chainId` хранится десятичной
 * строкой, а не `bigint`.
 *
 * Причина. Домен использует `bigint`, но требовать его поддержки от каждого
 * бэкенда хранилища — лишнее ограничение: `JSON.stringify` на `bigint`
 * выбрасывает исключение, а `chrome.storage` сериализует именно через JSON.
 * Преобразование в строку в одном месте делает данные переносимыми между
 * IndexedDB, `chrome.storage` и реализацией в памяти без кодеков.
 */
interface INetworkConfigRecord {
  readonly chainId: string
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly rpcUrls: readonly string[]
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean
  readonly isBuiltIn: boolean
  readonly supportsEip1559: boolean
}

function toRecord(config: INetworkConfig): INetworkConfigRecord {
  return {
    chainId: config.chainId.toString(),
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: config.rpcUrls,
    blockExplorerUrls: config.blockExplorerUrls,
    isTestnet: config.isTestnet,
    isBuiltIn: config.isBuiltIn,
    supportsEip1559: config.supportsEip1559,
  }
}

function fromRecord(record: INetworkConfigRecord): INetworkConfig {
  return {
    chainId: toChainId(record.chainId),
    name: record.name,
    nativeCurrency: record.nativeCurrency,
    rpcUrls: record.rpcUrls,
    blockExplorerUrls: record.blockExplorerUrls,
    isTestnet: record.isTestnet,
    isBuiltIn: record.isBuiltIn,
    supportsEip1559: record.supportsEip1559,
  }
}

/**
 * Хранение сетей поверх абстрактного хранилища.
 *
 * Класс не знает, что под ним: IndexedDB, `chrome.storage` или память.
 * Зависимость от `IStorageService` внедряется через конструктор.
 */
export class NetworkRepository implements INetworkRepository {
  readonly #storage: IStorageService

  constructor(storage: IStorageService) {
    this.#storage = storage
  }

  async findAll(): Promise<readonly INetworkConfig[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Networks)
    const configs: INetworkConfig[] = []

    for (const key of keys) {
      const record = await this.#storage.get<INetworkConfigRecord>(STORAGE_NAMESPACE.Networks, key)

      if (record !== null) {
        configs.push(fromRecord(record))
      }
    }

    return configs
  }

  async findByChainId(chainId: ChainId): Promise<INetworkConfig | null> {
    const record = await this.#storage.get<INetworkConfigRecord>(
      STORAGE_NAMESPACE.Networks,
      NetworkRepository.#keyOf(chainId),
    )

    return record === null ? null : fromRecord(record)
  }

  async save(config: INetworkConfig): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.Networks,
      NetworkRepository.#keyOf(config.chainId),
      toRecord(config),
    )
  }

  async delete(chainId: ChainId): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Networks, NetworkRepository.#keyOf(chainId))
  }

  async getActiveChainId(): Promise<ChainId | null> {
    const stored = await this.#storage.get<string>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.ActiveChainId,
    )

    if (stored === null) {
      return null
    }

    /* Значение из хранилища недоверенное: оно могло быть записано другой
       версией приложения либо повреждено. Некорректный идентификатор
       трактуется как отсутствие выбора, а не как повод остановить запуск. */
    try {
      return toChainId(stored)
    } catch {
      return null
    }
  }

  async setActiveChainId(chainId: ChainId): Promise<void> {
    await this.#storage.set(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.ActiveChainId,
      chainId.toString(),
    )
  }

  static #keyOf(chainId: ChainId) {
    return toStorageKey(chainId.toString())
  }
}
