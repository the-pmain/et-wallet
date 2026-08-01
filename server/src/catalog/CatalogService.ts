import type {
  INetworkResponse,
  INotificationResponse,
  IRpcEndpointResponse,
  ITokenResponse,
  IVersionResponse,
} from '../api/contracts.ts'
import { compareVersions } from '../lib/version.ts'

import { NETWORKS } from './networks.ts'
import { NOTIFICATIONS } from './notifications.ts'
import { RELEASES } from './releases.ts'
import { RPC_ENDPOINTS } from './rpc.ts'
import { TOKENS } from './tokens.ts'
import type {
  INetworkEntry,
  INotificationEntry,
  IReleaseCatalog,
  IRpcEntry,
  ITokenEntry,
} from './types.ts'
import {
  validateNetworks,
  validateNotifications,
  validateReleases,
  validateRpcEndpoints,
  validateTokens,
} from './validate.ts'

/** Содержимое каталога. Внедряется, чтобы тест мог подставить своё. */
export interface ICatalogData {
  readonly networks: readonly INetworkEntry[]
  readonly rpcEndpoints: readonly IRpcEntry[]
  readonly tokens: readonly ITokenEntry[]
  readonly notifications: readonly INotificationEntry[]
  readonly releases: IReleaseCatalog
}

/** Каталог из репозитория. */
export const REPOSITORY_CATALOG: ICatalogData = {
  networks: NETWORKS,
  rpcEndpoints: RPC_ENDPOINTS,
  tokens: TOKENS,
  notifications: NOTIFICATIONS,
  releases: RELEASES,
}

/**
 * Доступ к каталогу.
 *
 * ПРОВЕРКА ВЫПОЛНЯЕТСЯ В КОНСТРУКТОРЕ, А НЕ ПРИ ПЕРВОМ ЗАПРОСЕ.
 * Сервис с испорченным каталогом обязан не подняться: отказ при старте
 * виден тому, кто разворачивает сервис, а ошибка в выдаче не видна
 * никому, пока не станет поздно.
 *
 * ДАННЫЕ НЕИЗМЕНЯЕМЫ ВО ВРЕМЯ РАБОТЫ. Изменение каталога — это выпуск
 * новой версии сервиса, а не запись в базу: правка адреса контракта
 * обязана проходить через ревью и историю правок.
 */
export class CatalogService {
  readonly #data: ICatalogData
  readonly #knownChains: ReadonlySet<bigint>

  constructor(data: ICatalogData = REPOSITORY_CATALOG) {
    const knownChains = validateNetworks(data.networks)

    validateRpcEndpoints(data.rpcEndpoints, knownChains)
    validateTokens(data.tokens, knownChains)
    validateNotifications(data.notifications)
    validateReleases(data.releases)

    this.#data = data
    this.#knownChains = knownChains
  }

  /** Известна ли сеть каталогу. */
  hasNetwork(chainId: bigint): boolean {
    return this.#knownChains.has(chainId)
  }

  listNetworks(): readonly INetworkResponse[] {
    return this.#data.networks.map((entry) => ({
      chainId: entry.chainId.toString(),
      name: entry.name,
      nativeCurrency: entry.nativeCurrency,
      blockExplorerUrls: entry.blockExplorerUrls,
      isTestnet: entry.isTestnet,
      supportsEip1559: entry.supportsEip1559,
    }))
  }

  listRpcEndpoints(chainId: bigint): readonly IRpcEndpointResponse[] {
    return this.#data.rpcEndpoints
      .filter((entry) => entry.chainId === chainId)
      .map((entry) => ({ url: entry.url, operator: entry.operator, isPublic: entry.isPublic }))
  }

  /**
   * Рекомендуемые токены сети.
   *
   * Пустой список у известной сети означает «подтверждённых рекомендаций
   * нет», а не «токенов не существует». Разницу обязан передать клиент:
   * иначе пользователь прочитает пустоту как утверждение.
   */
  listTokens(chainId: bigint): readonly ITokenResponse[] {
    return this.#data.tokens
      .filter((entry) => entry.chainId === chainId)
      .map((entry) => ({
        chainId: entry.chainId.toString(),
        address: entry.address,
        symbol: entry.symbol,
        name: entry.name,
        decimals: entry.decimals,
        provenance: entry.provenance,
        verifiedAt: entry.verifiedAt,
      }))
  }

  /**
   * Действующие уведомления.
   *
   * @param now Текущий момент. Передаётся снаружи, чтобы поведение
   *        на границе срока проверялось тестом, а не наблюдалось
   *        однажды в проде.
   */
  listNotifications(now: Date): readonly INotificationResponse[] {
    const moment = now.getTime()

    return this.#data.notifications
      .filter((entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > moment)
      .map((entry) => ({
        id: entry.id,
        severity: entry.severity,
        title: entry.title,
        body: entry.body,
        publishedAt: entry.publishedAt,
        expiresAt: entry.expiresAt,
      }))
  }

  /**
   * Состояние версии клиента.
   *
   * @param clientVersion Версия, о которой спрашивает клиент. `null`,
   *        если она не сообщена: тогда сравнивать не с чем, и признаки
   *        остаются `null`. «Не знаем» нельзя подменять ни на «всё
   *        в порядке», ни на «пора обновляться» — оба ответа были бы
   *        утверждением из ничего.
   */
  getVersionStatus(clientVersion: string | null): IVersionResponse {
    const { latest, minSupported, advisory } = this.#data.releases

    if (clientVersion === null) {
      return { latest, minSupported, isSupported: null, isOutdated: null, advisory }
    }

    return {
      latest,
      minSupported,
      isSupported: compareVersions(clientVersion, minSupported) >= 0,
      isOutdated: compareVersions(clientVersion, latest) < 0,
      advisory,
    }
  }
}
