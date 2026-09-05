import { NOTIFICATION_SEVERITY } from '../api/contracts.ts'
import { hasValidChecksum } from '../lib/address.ts'
import { CatalogValidationError } from '../lib/errors.ts'
import { compareVersions, isValidVersion } from '../lib/version.ts'

import type {
  INetworkEntry,
  INotificationEntry,
  IReleaseCatalog,
  IRpcEntry,
  ITokenEntry,
} from './types.ts'

/**
 * Catalog validation on load.
 *
 * A SERVICE WITH A CORRUPT CATALOG MUST NOT START. Serving a
 * mistyped contract address is worse than serving nothing: the user
 * will send money there, and the transfer is irreversible. A startup
 * refusal is seen immediately by whoever deploys the service; an
 * error in the response is seen by nobody until it is too late.
 */

const LIMIT = {
  Name: 64,
  Symbol: 16,
  NotificationTitle: 80,
  NotificationBody: 500,
  Advisory: 300,
} as const

const MAX_DECIMALS = 36

/**
 * Link-like patterns in text.
 *
 * Not only full URLs: `example.com` without a scheme is still read
 * as a link by the browser and the user.
 */
const LINK_PATTERNS: readonly RegExp[] = [
  /https?:\/\//iu,
  /\bwww\./iu,
  /[a-z0-9-]+\.(com|org|net|io|xyz|app|finance|money|link|ru)\b/iu,
]

/** Rejects text that looks like a link. */
function assertNoLinks(where: string, text: string): void {
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(text)) {
      throw new CatalogValidationError(
        `${where}: the text contains a link. A service message shown inside the wallet ` +
          'looks like a message from the wallet itself, and the link can go anywhere.',
      )
    }
  }
}

function assertText(where: string, value: string, limit: number): void {
  if (value.trim() === '') {
    throw new CatalogValidationError(`${where}: empty value`)
  }

  if (value.length > limit) {
    throw new CatalogValidationError(
      `${where}: length ${String(value.length)} exceeds the limit ${String(limit)}`,
    )
  }
}

function assertHttpsUrl(where: string, value: string): void {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new CatalogValidationError(`${where}: address is not parseable: ${value}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new CatalogValidationError(
      `${where}: only https is allowed, received ${parsed.protocol}//. ` +
        'An unencrypted connection lets someone swap the node response in transit.',
    )
  }
}

function assertTimestamp(where: string, value: string): number {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new CatalogValidationError(`${where}: unreadable timestamp: ${value}`)
  }

  return parsed
}

export function validateNetworks(networks: readonly INetworkEntry[]): ReadonlySet<bigint> {
  if (networks.length === 0) {
    throw new CatalogValidationError('network catalog is empty')
  }

  const known = new Set<bigint>()

  for (const network of networks) {
    const where = `network ${network.name}`

    if (network.chainId <= 0n) {
      throw new CatalogValidationError(`${where}: the network identifier must be positive`)
    }

    if (known.has(network.chainId)) {
      throw new CatalogValidationError(
        `${where}: identifier ${network.chainId.toString()} appears twice. ` +
          'Two networks with the same identifier are indistinguishable to the wallet.',
      )
    }

    known.add(network.chainId)

    assertText(where, network.name, LIMIT.Name)
    assertText(`${where}: currency symbol`, network.nativeCurrency.symbol, LIMIT.Symbol)
    assertText(`${where}: currency name`, network.nativeCurrency.name, LIMIT.Name)

    if (
      !Number.isInteger(network.nativeCurrency.decimals) ||
      network.nativeCurrency.decimals < 0 ||
      network.nativeCurrency.decimals > MAX_DECIMALS
    ) {
      throw new CatalogValidationError(`${where}: invalid currency decimal count`)
    }

    for (const url of network.blockExplorerUrls) {
      assertHttpsUrl(`${where}: explorer`, url)
    }
  }

  return known
}

export function validateRpcEndpoints(
  endpoints: readonly IRpcEntry[],
  knownChains: ReadonlySet<bigint>,
): void {
  const seen = new Set<string>()

  for (const endpoint of endpoints) {
    const where = `RPC ${endpoint.url}`

    if (!knownChains.has(endpoint.chainId)) {
      throw new CatalogValidationError(
        `${where}: network ${endpoint.chainId.toString()} is missing from the network catalog`,
      )
    }

    assertHttpsUrl(where, endpoint.url)
    assertText(`${where}: operator`, endpoint.operator, LIMIT.Name)

    const key = `${endpoint.chainId.toString()}:${endpoint.url}`

    if (seen.has(key)) {
      throw new CatalogValidationError(`${where}: the address is repeated on the same network`)
    }

    seen.add(key)
  }

  /* A network with no node turns switching to it into a dead wallet:
     there is nowhere to send requests. */
  for (const chainId of knownChains) {
    if (!endpoints.some((endpoint) => endpoint.chainId === chainId)) {
      throw new CatalogValidationError(`network ${chainId.toString()} has no RPC address`)
    }
  }
}

export function validateTokens(
  tokens: readonly ITokenEntry[],
  knownChains: ReadonlySet<bigint>,
): void {
  const seen = new Set<string>()

  for (const entry of tokens) {
    const where = `token ${entry.symbol} (${entry.address})`

    if (!knownChains.has(entry.chainId)) {
      throw new CatalogValidationError(
        `${where}: network ${entry.chainId.toString()} is missing from the network catalog`,
      )
    }

    /* EIP-55 checksum catches an address typo on load — before a
       wrong address reaches wallets. */
    if (!hasValidChecksum(entry.address)) {
      throw new CatalogValidationError(
        `${where}: the address is missing an EIP-55 checksum or the checksum is wrong`,
      )
    }

    const key = `${entry.chainId.toString()}:${entry.address.toLowerCase()}`

    if (seen.has(key)) {
      throw new CatalogValidationError(`${where}: the address is repeated on the same network`)
    }

    seen.add(key)

    assertText(`${where}: symbol`, entry.symbol, LIMIT.Symbol)
    assertText(`${where}: name`, entry.name, LIMIT.Name)

    if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > MAX_DECIMALS) {
      throw new CatalogValidationError(`${where}: invalid decimal count`)
    }

    /* A record with no source is a recommendation with no basis.
       Serving it would pass someone else's trust off as ours. */
    if (entry.provenance.length === 0) {
      throw new CatalogValidationError(`${where}: no confirmation source is given`)
    }

    assertTimestamp(`${where}: verification date`, entry.verifiedAt)
  }
}

export function validateNotifications(notifications: readonly INotificationEntry[]): void {
  const seen = new Set<string>()
  const severities = new Set<string>(Object.values(NOTIFICATION_SEVERITY))

  for (const entry of notifications) {
    const where = `notification ${entry.id}`

    if (seen.has(entry.id)) {
      throw new CatalogValidationError(
        `${where}: the identifier is repeated. The client uses it to remember what was already shown.`,
      )
    }

    seen.add(entry.id)

    if (!severities.has(entry.severity)) {
      throw new CatalogValidationError(`${where}: unknown severity ${entry.severity}`)
    }

    assertText(`${where}: title`, entry.title, LIMIT.NotificationTitle)
    assertText(`${where}: body`, entry.body, LIMIT.NotificationBody)

    assertNoLinks(`${where}: title`, entry.title)
    assertNoLinks(`${where}: body`, entry.body)

    const published = assertTimestamp(`${where}: publication date`, entry.publishedAt)

    if (entry.expiresAt !== null) {
      const expires = assertTimestamp(`${where}: expiry date`, entry.expiresAt)

      if (expires <= published) {
        throw new CatalogValidationError(
          `${where}: expiry is earlier than publication — this notification would never be shown`,
        )
      }
    }
  }
}

export function validateReleases(releases: IReleaseCatalog): void {
  for (const [field, value] of [
    ['latest', releases.latest],
    ['minSupported', releases.minSupported],
  ] as const) {
    if (!isValidVersion(value)) {
      throw new CatalogValidationError(`releases: field ${field} looks like "${value}"`)
    }
  }

  if (compareVersions(releases.minSupported, releases.latest) > 0) {
    throw new CatalogValidationError(
      'releases: the minimum supported version is above the latest — ' +
        'with that catalog everyone would be unsupported, including fresh installs',
    )
  }

  if (releases.advisory !== null) {
    assertText('releases: advisory', releases.advisory, LIMIT.Advisory)
    assertNoLinks('releases: advisory', releases.advisory)
  }
}
