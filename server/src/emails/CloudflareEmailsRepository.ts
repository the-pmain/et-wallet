import { cloudflareAuthHeaders } from '../email/credentials.ts'

import {
  EMAIL_DIRECTION,
  type ICreateEmailInput,
  type IEmailRecord,
  type IEmailsRepository,
} from './contracts.ts'
import { MemoryEmailsRepository } from './MemoryEmailsRepository.ts'

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const MAILBOX_QUERY = `
query Mailbox($zoneTag: string!, $start: Time!, $end: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      emailSendingAdaptive(
        filter: { datetime_geq: $start, datetime_leq: $end }
        limit: 100
        orderBy: [datetime_DESC]
      ) {
        datetime from to subject status eventType messageId errorCause errorDetail
      }
      emailRoutingAdaptive(
        filter: { datetime_geq: $start, datetime_leq: $end }
        limit: 100
        orderBy: [datetime_DESC]
      ) {
        datetime from to subject status action messageId errorDetail
      }
    }
  }
}`

/**
 * Mail list from Cloudflare: sent and inbound from the activity log,
 * bodies from KV if the Worker put them there.
 */
export class CloudflareEmailsRepository implements IEmailsRepository {
  readonly #accountId: string
  readonly #apiToken: string
  readonly #authEmail: string | null
  readonly #zoneId: string
  readonly #kvNamespaceId: string | null
  readonly #fetch: typeof fetch
  readonly #overlay = new MemoryEmailsRepository()

  constructor(options: {
    readonly accountId: string
    readonly apiToken: string
    readonly authEmail?: string | null
    readonly zoneId: string
    readonly kvNamespaceId?: string | null
    readonly fetch?: typeof fetch
  }) {
    this.#accountId = options.accountId
    this.#apiToken = options.apiToken
    this.#authEmail = options.authEmail ?? null
    this.#zoneId = options.zoneId
    this.#kvNamespaceId = options.kvNamespaceId ?? null
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async create(input: ICreateEmailInput): Promise<IEmailRecord> {
    const record = await this.#overlay.create(input)

    await this.#putKv(record)

    return record
  }

  async list(options?: { readonly limit?: number }): Promise<readonly IEmailRecord[]> {
    const limit = options?.limit ?? 100
    const overlay = await this.#overlay.list({ limit })
    const stored = await this.#listKvSafe()
    const remote = await this.#listGraphqlSafe()

    return mergeRecords([...overlay, ...stored, ...remote]).slice(0, limit)
  }

  async findById(id: string): Promise<IEmailRecord | null> {
    const records = await this.list({ limit: 100 })

    return records.find((entry) => entry.id === id) ?? null
  }

  async findByExternalId(externalId: string): Promise<IEmailRecord | null> {
    const records = await this.list({ limit: 100 })

    return records.find((entry) => entry.externalId === externalId) ?? null
  }

  async #listGraphql(): Promise<readonly IEmailRecord[]> {
    const end = new Date()
    const start = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000)
    const response = await this.#fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        ...cloudflareAuthHeaders(this.#apiToken, this.#authEmail),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: MAILBOX_QUERY,
        variables: {
          zoneTag: this.#zoneId,
          start: start.toISOString(),
          end: end.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })

    const envelope = (await response.json()) as {
      readonly errors?: readonly { readonly message?: string }[]
      readonly data?: {
        readonly viewer?: {
          readonly zones?: readonly {
            readonly emailSendingAdaptive?: readonly IGraphqlEvent[]
            readonly emailRoutingAdaptive?: readonly IGraphqlEvent[]
          }[]
        }
      }
    }

    const graphqlError = envelope.errors?.[0]?.message

    if (!response.ok || (typeof graphqlError === 'string' && graphqlError.trim() !== '')) {
      throw new Error(
        `Cloudflare mailbox query failed: ${graphqlError ?? `HTTP ${String(response.status)}`}`,
      )
    }

    const zone = envelope.data?.viewer?.zones?.[0]
    const sending = (zone?.emailSendingAdaptive ?? []).map((event) =>
      toRecord(event, EMAIL_DIRECTION.Sent),
    )
    const routing = (zone?.emailRoutingAdaptive ?? []).map((event) =>
      toRecord(event, EMAIL_DIRECTION.Received),
    )

    return mergeRecords([...sending, ...routing])
  }

  async #listGraphqlSafe(): Promise<readonly IEmailRecord[]> {
    try {
      return await this.#listGraphql()
    } catch (error) {
      console.warn(
        `Cloudflare GraphQL mailbox failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      )

      return []
    }
  }

  async #listKvSafe(): Promise<readonly IEmailRecord[]> {
    try {
      return await this.#listKv()
    } catch (error) {
      console.warn(
        `Cloudflare KV mailbox failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      )

      return []
    }
  }

  async #listKv(): Promise<readonly IEmailRecord[]> {
    const namespaceId = this.#kvNamespaceId

    if (namespaceId === null) {
      return []
    }

    const listed = await this.#cfJson(
      `/accounts/${this.#accountId}/storage/kv/namespaces/${namespaceId}/keys?limit=100`,
    )
    const keys = Array.isArray(listed['result'])
      ? listed['result'].filter(
          (item): item is { readonly name: string } =>
            item !== null &&
            typeof item === 'object' &&
            typeof (item as { name?: unknown }).name === 'string',
        )
      : []

    const records: IEmailRecord[] = []

    for (const key of keys) {
      const record = await this.#readKv(namespaceId, key.name)

      if (record !== null) {
        records.push(record)
      }
    }

    return records
  }

  async #readKv(namespaceId: string, key: string): Promise<IEmailRecord | null> {
    const response = await this.#fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      {
        headers: cloudflareAuthHeaders(this.#apiToken, this.#authEmail),
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (!response.ok) {
      return null
    }

    const raw = await response.text()

    try {
      return parseStoredRecord(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }

  async #putKv(record: IEmailRecord): Promise<void> {
    const namespaceId = this.#kvNamespaceId

    if (namespaceId === null) {
      return
    }

    const key = `${record.direction}:${record.id}`
    const response = await this.#fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: {
          ...cloudflareAuthHeaders(this.#apiToken, this.#authEmail),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(recordToStored(record)),
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (!response.ok) {
      console.warn(`Cloudflare KV did not store ${key}: HTTP ${String(response.status)}`)
    }
  }

  async #cfJson(path: string): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: {
        ...cloudflareAuthHeaders(this.#apiToken, this.#authEmail),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    const parsed = (await response.json()) as unknown

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed as Record<string, unknown>
  }
}

interface IGraphqlEvent {
  readonly datetime?: string
  readonly from?: string
  readonly to?: string
  readonly subject?: string
  readonly status?: string
  readonly action?: string
  readonly eventType?: string
  readonly messageId?: string
  readonly errorCause?: string
  readonly errorDetail?: string
}

function toRecord(event: IGraphqlEvent, direction: IEmailRecord['direction']): IEmailRecord {
  const messageId = readTrimmed(event.messageId)
  const createdAt = parseDate(event.datetime)
  const status = readTrimmed(event.status) ?? readTrimmed(event.action) ?? 'unknown'
  const error = readTrimmed(event.errorCause) ?? readTrimmed(event.errorDetail)
  const id = messageId === null ? `cf-${direction}-${createdAt.toISOString()}` : stripAngles(messageId)
  const errorText = error === null || error === 'unknown' ? null : error

  return {
    id,
    createdAt,
    direction,
    from: readTrimmed(event.from) ?? '',
    to: readTrimmed(event.to) ?? '',
    subject: readTrimmed(event.subject) ?? '',
    html: null,
    text: errorText,
    status,
    providerResult: {
      eventType: event.eventType ?? null,
      action: event.action ?? null,
    },
    externalId: messageId,
  }
}

function mergeRecords(records: readonly IEmailRecord[]): IEmailRecord[] {
  const byKey = new Map<string, IEmailRecord>()

  for (const record of records) {
    const key = record.externalId ?? record.id
    const existing = byKey.get(key)

    if (existing === undefined) {
      byKey.set(key, record)
      continue
    }

    byKey.set(key, preferRecord(existing, record))
  }

  return [...byKey.values()].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )
}

function preferRecord(left: IEmailRecord, right: IEmailRecord): IEmailRecord {
  const newer = left.createdAt.getTime() >= right.createdAt.getTime() ? left : right
  const older = newer === left ? right : left
  const html = newer.html ?? older.html
  const text = newer.text ?? older.text

  return {
    ...newer,
    html,
    text,
    status: newer.status === 'unknown' ? older.status : newer.status,
  }
}

function recordToStored(record: IEmailRecord): Record<string, unknown> {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    direction: record.direction,
    from: record.from,
    to: record.to,
    subject: record.subject,
    html: record.html,
    text: record.text,
    status: record.status,
    providerResult: record.providerResult,
    externalId: record.externalId,
  }
}

function parseStoredRecord(value: unknown): IEmailRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const id = readTrimmed(record['id'])
  const from = readTrimmed(record['from'])
  const to = readTrimmed(record['to'])
  const direction = record['direction']

  if (
    id === null ||
    from === null ||
    to === null ||
    (direction !== EMAIL_DIRECTION.Sent && direction !== EMAIL_DIRECTION.Received)
  ) {
    return null
  }

  return {
    id,
    createdAt: parseDate(record['createdAt']),
    direction,
    from,
    to,
    subject: readTrimmed(record['subject']) ?? '',
    html: readTrimmed(record['html']),
    text: readTrimmed(record['text']),
    status: readTrimmed(record['status']) ?? 'unknown',
    providerResult: record['providerResult'] ?? null,
    externalId: readTrimmed(record['externalId']),
  }
}

function parseDate(value: unknown): Date {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)

    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return new Date()
}

function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

function stripAngles(value: string): string {
  return value.replace(/^<|>$/gu, '')
}
