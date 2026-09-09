import { randomUUID } from 'node:crypto'

import { ServiceUnavailableError } from '../lib/errors.ts'

import {
  type EmailDirection,
  type ICreateEmailInput,
  type IEmailRecord,
  type IEmailsRepository,
} from './contracts.ts'
import { isEmailDirection } from './MemoryEmailsRepository.ts'
import { signedS3Headers } from './s3-sign.ts'

const OBJECT_PREFIX = 'mailbox/'
const R2_REGION = 'auto'

interface IStoredEmail {
  readonly id: string
  readonly createdAt: string
  readonly direction: EmailDirection
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html: string | null
  readonly text: string | null
  readonly status: string
  readonly providerResult: unknown | null
  readonly externalId: string | null
}

/**
 * Mail journal in Cloudflare R2.
 *
 * Cloudflare Email Sending has no inbox API. R2 holds sent and inbound
 * mail as JSON so the cabinet survives a process restart.
 */
export class R2EmailsRepository implements IEmailsRepository {
  readonly #endpoint: URL
  readonly #bucket: string
  readonly #accessKeyId: string
  readonly #secretAccessKey: string
  readonly #accountId: string | null
  readonly #apiToken: string | null
  readonly #fetch: typeof fetch

  constructor(options: {
    readonly endpoint: string
    readonly bucket: string
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly accountId?: string | null
    readonly apiToken?: string | null
    readonly fetch?: typeof fetch
  }) {
    this.#endpoint = new URL(options.endpoint.replace(/\/$/u, ''))
    this.#bucket = options.bucket
    this.#accessKeyId = options.accessKeyId
    this.#secretAccessKey = options.secretAccessKey
    this.#accountId = options.accountId ?? null
    this.#apiToken = options.apiToken ?? null
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async ensureReady(): Promise<void> {
    const listed = await this.#s3('GET', `/${this.#bucket}?list-type=2&prefix=${OBJECT_PREFIX}&max-keys=1`, Buffer.alloc(0))

    if (listed.status === 200) {
      return
    }

    if (listed.status !== 404) {
      throw new ServiceUnavailableError(summarizeR2Failure('open', listed.status, listed.body))
    }

    await this.#createBucket()
  }

  async create(input: ICreateEmailInput): Promise<IEmailRecord> {
    const record: IEmailRecord = {
      id: randomUUID(),
      createdAt: new Date(),
      direction: input.direction,
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html ?? null,
      text: input.text ?? null,
      status: input.status,
      providerResult: input.providerResult ?? null,
      externalId: input.externalId ?? null,
    }

    const body = Buffer.from(JSON.stringify(toStored(record)), 'utf8')
    const put = await this.#s3(
      'PUT',
      `/${this.#bucket}/${objectKey(record)}`,
      body,
      { 'content-type': 'application/json' },
    )

    if (put.status !== 200 && put.status !== 204) {
      throw new ServiceUnavailableError(
        `Could not store the email in R2 (${String(put.status)}).`,
      )
    }

    return record
  }

  async list(options?: { readonly limit?: number }): Promise<readonly IEmailRecord[]> {
    const limit = options?.limit ?? 100
    const listed = await this.#s3(
      'GET',
      `/${this.#bucket}?list-type=2&prefix=${OBJECT_PREFIX}&max-keys=1000`,
      Buffer.alloc(0),
    )

    if (listed.status !== 200) {
      throw new ServiceUnavailableError(
        summarizeR2Failure('list', listed.status, listed.body),
      )
    }

    const keys = [...parseListKeys(listed.body)].sort((left, right) =>
      right.localeCompare(left),
    )
    const records: IEmailRecord[] = []

    for (const key of keys) {
      if (records.length >= limit) {
        break
      }

      const record = await this.#readKey(key)

      if (record !== null) {
        records.push(record)
      }
    }

    return records.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  }

  async findById(id: string): Promise<IEmailRecord | null> {
    const records = await this.list({ limit: 1000 })

    return records.find((entry) => entry.id === id) ?? null
  }

  async findByExternalId(externalId: string): Promise<IEmailRecord | null> {
    const records = await this.list({ limit: 1000 })

    return records.find((entry) => entry.externalId === externalId) ?? null
  }

  async #readKey(key: string): Promise<IEmailRecord | null> {
    const response = await this.#s3('GET', `/${this.#bucket}/${key}`, Buffer.alloc(0))

    if (response.status !== 200) {
      return null
    }

    return parseStored(response.body)
  }

  async #createBucket(): Promise<void> {
    if (this.#accountId === null || this.#apiToken === null) {
      throw new ServiceUnavailableError(
        `R2 bucket "${this.#bucket}" does not exist. Create it in Cloudflare or set CLOUDFLARE_API_TOKEN.`,
      )
    }

    const response = await this.#fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/r2/buckets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: this.#bucket }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    const raw = await response.text()

    if (response.ok || isAlreadyExists(response.status, raw)) {
      return
    }

    throw new ServiceUnavailableError(
      `Could not create R2 bucket "${this.#bucket}" (${String(response.status)}).`,
    )
  }

  async #s3(
    method: string,
    pathAndQuery: string,
    body: Buffer,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<{ readonly status: number; readonly body: string }> {
    const url = new URL(pathAndQuery, this.#endpoint)
    const headers = signedS3Headers({
      method,
      url,
      body,
      accessKeyId: this.#accessKeyId,
      secretAccessKey: this.#secretAccessKey,
      region: R2_REGION,
      extraHeaders,
    })

    let response: Response

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(20_000),
      }

      if (method !== 'GET' && method !== 'HEAD') {
        init.body = body
      }

      response = await this.#fetch(url, init)
    } catch {
      throw new ServiceUnavailableError('Could not reach Cloudflare R2.')
    }

    return { status: response.status, body: await response.text() }
  }
}

function objectKey(record: IEmailRecord): string {
  const stamp = String(record.createdAt.getTime()).padStart(13, '0')

  return `${OBJECT_PREFIX}${stamp}-${record.id}.json`
}

function toStored(record: IEmailRecord): IStoredEmail {
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

function parseStored(raw: string): IEmailRecord | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  const id = record['id']
  const createdAt = record['createdAt']
  const direction = record['direction']
  const from = record['from']
  const to = record['to']
  const subject = record['subject']
  const html = record['html']
  const text = record['text']
  const status = record['status']
  const externalId = record['externalId']

  if (
    typeof id !== 'string' ||
    typeof createdAt !== 'string' ||
    !isEmailDirection(direction) ||
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    typeof subject !== 'string' ||
    (html !== null && typeof html !== 'string') ||
    (text !== null && typeof text !== 'string') ||
    typeof status !== 'string' ||
    (externalId !== null && typeof externalId !== 'string')
  ) {
    return null
  }

  const created = new Date(createdAt)

  if (Number.isNaN(created.getTime())) {
    return null
  }

  return {
    id,
    createdAt: created,
    direction,
    from,
    to,
    subject,
    html: html ?? null,
    text: text ?? null,
    status,
    providerResult: record['providerResult'] ?? null,
    externalId: externalId ?? null,
  }
}

function parseListKeys(xml: string): readonly string[] {
  const keys: string[] = []
  const pattern = /<Key>([^<]+)<\/Key>/gu

  for (const match of xml.matchAll(pattern)) {
    const key = match[1]

    if (key !== undefined && key.startsWith(OBJECT_PREFIX)) {
      keys.push(key)
    }
  }

  return keys
}

function summarizeR2Failure(action: string, status: number, body: string): string {
  const trimmed = body.replace(/\s+/gu, ' ').trim().slice(0, 180)

  if (trimmed.includes('enable R2')) {
    return 'Cloudflare R2 is not enabled on this account. Enable R2 in the dashboard.'
  }

  return trimmed === ''
    ? `Could not ${action} the R2 mailbox (${String(status)}).`
    : `Could not ${action} the R2 mailbox (${String(status)}): ${trimmed}`
}

function isAlreadyExists(status: number, raw: string): boolean {
  if (status !== 409) {
    return false
  }

  return raw.includes('already exists') || raw.includes('10004')
}

export function isR2Configured<
  T extends {
    readonly r2AccessKeyId: string | null
    readonly r2SecretAccessKey: string | null
    readonly r2Endpoint: string | null
    readonly r2Bucket: string | null
  },
>(
  options: T,
): options is T & {
  readonly r2AccessKeyId: string
  readonly r2SecretAccessKey: string
  readonly r2Endpoint: string
  readonly r2Bucket: string
} {
  return (
    options.r2AccessKeyId !== null &&
    options.r2SecretAccessKey !== null &&
    options.r2Endpoint !== null &&
    options.r2Bucket !== null
  )
}
