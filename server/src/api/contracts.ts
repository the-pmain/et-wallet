/**
 * HTTP API contract.
 *
 * WHAT IS ABSENT FROM RESPONSES: seed phrase, private key, `the_p`.
 * User creation accepts `seed_phrase` in the `POST /v1/users` body
 * and does not return it. Private key and a sign request still are
 * not part of the contract.
 *
 * NUMBERS THAT DO NOT FIT IN `number` ARE SENT AS STRINGS. `chainId`
 * is not limited to 53 bits by the spec, and `JSON.parse` silently
 * loses precision. A network id that differs from the real one is a
 * transaction signature for another chain.
 */

export interface INativeCurrency {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

export interface INetworkResponse {
  /** Network id as a decimal string. */
  readonly chainId: string

  readonly name: string
  readonly nativeCurrency: INativeCurrency
  readonly blockExplorerUrls: readonly string[]
  readonly isTestnet: boolean

  /**
   * Whether the network supports EIP-1559 in practice.
   *
   * Distinct from formal support: a network may accept type-2
   * transactions but not change inclusion speed from the priority fee.
   * Showing an urgency picker that does nothing is a UI lie.
   */
  readonly supportsEip1559: boolean
}

export interface IRpcEndpointResponse {
  readonly url: string

  /** Node operator. The user is entitled to know who receives their requests. */
  readonly operator: string

  /**
   * The node is public and needs no key.
   *
   * Public is not free: the operator sees the user's IP and every
   * request — which addresses are checked and when. That is enough
   * to link an identity to a portfolio.
   */
  readonly isPublic: boolean
}

export interface ITokenResponse {
  readonly chainId: string

  /** Contract address in EIP-55 checksum form. */
  readonly address: string

  readonly symbol: string
  readonly name: string
  readonly decimals: number

  /**
   * What backs the address.
   *
   * A list of sources, not a "verified" flag: trust is not checkable,
   * origin is. The client may show it to the user and decide whether
   * it is enough.
   */
  readonly provenance: readonly string[]

  /** Last on-chain contract check, ISO 8601. */
  readonly verifiedAt: string
}

export const NOTIFICATION_SEVERITY = {
  Info: 'info',
  Warning: 'warning',
  Critical: 'critical',
} as const

export type NotificationSeverity =
  (typeof NOTIFICATION_SEVERITY)[keyof typeof NOTIFICATION_SEVERITY]

/**
 * System notification.
 *
 * TEXT ONLY. No markup, no links, no action buttons.
 * A server message shown inside the wallet looks to the user like a
 * message from the wallet itself — a ready social-engineering channel.
 * A link in such a message goes anywhere, and markup can fake the
 * wallet's own warning chrome.
 */
export interface INotificationResponse {
  readonly id: string
  readonly severity: NotificationSeverity
  readonly title: string
  readonly body: string
  readonly publishedAt: string

  /** After this instant the notification is not shown. `null` — no expiry. */
  readonly expiresAt: string | null
}

export interface IVersionResponse {
  readonly latest: string

  /** Below this version the app is unsupported. */
  readonly minSupported: string

  /**
   * Client version is at least the minimum supported.
   *
   * `null` if the client did not report its version: nothing to compare.
   * Substituting `true` would claim support nobody checked; `false`
   * would call something unknown outdated.
   */
  readonly isSupported: boolean | null

  /** A newer release exists than the version the client asked about. `null` — see above. */
  readonly isOutdated: boolean | null

  /**
   * Release note. Text without links.
   *
   * NO DOWNLOAD URL HERE, ON PURPOSE. A service that says "your version
   * is outdated, download from here" is a ready way to send the user
   * to a fake installer. The store URL is baked into the client and
   * changes only with a new release.
   */
  readonly advisory: string | null
}

/**
 * Encrypted user settings.
 *
 * THE SERVER STORES CIPHERTEXT AND CANNOT READ IT. The key is derived
 * on the device and never leaves; the service has neither decryption
 * nor a place such a key could be passed to.
 *
 * The sync id is tied to no wallet address. An "id — address" link
 * would turn the service into an "identity — portfolio" registry —
 * exactly the leak the wallet is built against.
 */
export interface ISettingsResponse {
  readonly ciphertext: string

  /** Record revision. Grows on every successful write. */
  readonly revision: number

  readonly updatedAt: string
}

/** One `wallets` entry: address and string value. */
export interface IWalletSlotResponse {
  readonly key: string
  readonly value: string
}

export interface IAssetTokenResponse {
  readonly chainId: string
  readonly standard: 'native' | 'ERC-20'
  readonly address: string | null
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly balance: string
  readonly isVerified: boolean
}

export interface IUserAssetsResponse {
  readonly quoteCurrency: 'USD'
  readonly updatedAt: string
  readonly tokens: readonly IAssetTokenResponse[]
}

/**
 * User in `public.users`.
 *
 * Columns `the_p` and `seed_phrase` are not in the response.
 * `wallets` is a `{ codename: { key, value } }` map. `assets` is the portfolio showcase.
 */
export interface IUserResponse {
  readonly id: string
  readonly email: string | null
  readonly balance: string | null
  readonly createdAt: string
  readonly wallets: Readonly<Record<string, IWalletSlotResponse>>
  readonly assets: IUserAssetsResponse
}

export interface ISendingResponse {
  readonly id: string
  readonly createdAt: string
  readonly userId: string | null
  readonly status: 'pending' | 'success' | 'failure' | null
  readonly failureMessage: string | null
  readonly recipientAddress: string | null
  readonly amount: string | null
  readonly symbol: string | null
}

/** Why a frame went into the `sendings` stream. */
export const SENDING_SSE_TYPE = {
  Create: 'create',
  Update: 'update',
} as const

export type SendingSseType = (typeof SENDING_SSE_TYPE)[keyof typeof SENDING_SSE_TYPE]

/**
 * Frame of the `GET /v1/sendings` stream.
 *
 * Same fields as the create response, plus `type_send` so the client
 * can tell a new row from later status changes.
 */
export interface ISendingSseEvent extends ISendingResponse {
  readonly type_send: SendingSseType
}

/** Rejection response. The same shape on every route. */
export interface IErrorResponse {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
