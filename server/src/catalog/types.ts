import type { INativeCurrency, NotificationSeverity } from '../api/contracts.ts'

/**
 * Network-catalog record.
 *
 * STORED IN THE REPOSITORY, NOT IN A DATABASE. The catalog decides
 * which contract addresses the wallet shows as recommended — that is,
 * where the user will send money. Changing such a value must go
 * through review and history, not an `UPDATE` in a database that
 * anyone with server access can run.
 */
export interface INetworkEntry {
  readonly chainId: bigint
  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean
  readonly supportsEip1559: boolean
}

export interface IRpcEntry {
  readonly chainId: bigint
  readonly url: string
  readonly operator: string
  readonly isPublic: boolean
}

export interface ITokenEntry {
  readonly chainId: bigint
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number

  /** Sources that confirm the address. An empty list is not allowed. */
  readonly provenance: readonly string[]

  /** Last on-chain contract check, ISO 8601. */
  readonly verifiedAt: string
}

export interface INotificationEntry {
  readonly id: string
  readonly severity: NotificationSeverity
  readonly title: string
  readonly body: string
  readonly publishedAt: string
  readonly expiresAt: string | null
}

export interface IReleaseCatalog {
  readonly latest: string
  readonly minSupported: string
  readonly advisory: string | null
}
