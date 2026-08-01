import type { INativeCurrency, NotificationSeverity } from '../api/contracts.ts'

/**
 * Запись каталога сетей.
 *
 * ХРАНИТСЯ В РЕПОЗИТОРИИ, А НЕ В БАЗЕ ДАННЫХ. Каталог определяет, какие
 * адреса контрактов кошелёк покажет как рекомендованные, — то есть
 * куда пользователь отправит деньги. Изменение такого значения обязано
 * проходить через ревью и историю правок, а не через `UPDATE` в базе,
 * доступный любому, кто получил доступ к серверу.
 */
export interface INetworkEntry {
  readonly chainId: bigint
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean
  readonly supportsEip1559: boolean
}

/** Запись каталога RPC-адресов. */
export interface IRpcEntry {
  readonly chainId: bigint
  readonly url: string
  readonly operator: string
  readonly isPublic: boolean
}

/** Запись каталога токенов. */
export interface ITokenEntry {
  readonly chainId: bigint
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number

  /** Источники, по которым адрес подтверждён. Пустой список недопустим. */
  readonly provenance: readonly string[]

  /** Дата последней сверки с контрактом в сети, ISO 8601. */
  readonly verifiedAt: string
}

/** Запись каталога уведомлений. */
export interface INotificationEntry {
  readonly id: string
  readonly severity: NotificationSeverity
  readonly title: string
  readonly body: string
  readonly publishedAt: string
  readonly expiresAt: string | null
}

/** Сведения о выпусках приложения. */
export interface IReleaseCatalog {
  readonly latest: string
  readonly minSupported: string
  readonly advisory: string | null
}
