import { cloudflareAuthHeaders } from '../email/credentials.ts'

const KV_TITLE = 'etwallet-mailbox'
export const INBOX_WORKER_NAME = 'etwallet-inbox'

const WORKER_SCRIPT = `export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text()
    const subject = message.headers.get('subject') ?? ''
    const messageId = message.headers.get('message-id') ?? crypto.randomUUID()
    const id = stripAngles(messageId)
    const createdAt = new Date().toISOString()
    await env.MAILBOX.put(
      'received:' + id,
      JSON.stringify({
        id,
        createdAt,
        direction: 'received',
        from: message.from,
        to: message.to,
        subject,
        html: extractPart(raw, 'text/html'),
        text: extractPart(raw, 'text/plain') ?? raw.slice(0, 4000),
        status: 'received',
        providerResult: { source: 'email-worker' },
        externalId: messageId,
      }),
    )
  },
}

function stripAngles(value) {
  return String(value).replace(/^<|>$/g, '')
}

function extractPart(raw, type) {
  const needle = 'content-type: ' + type
  const lower = raw.toLowerCase()
  const index = lower.indexOf(needle)
  if (index < 0) return null
  const rest = raw.slice(index)
  const split = rest.search(/\\r?\\n\\r?\\n/)
  if (split < 0) return null
  let body = rest.slice(split).trim()
  const end = body.search(/\\r?\\n--/)
  if (end >= 0) body = body.slice(0, end).trim()
  return body === '' ? null : body
}
`

export interface ICloudflareInbox {
  readonly kvNamespaceId: string | null
  readonly warning: string | null
}

/**
 * KV + Worker + catch-all so inbound mail @zone lands in the inbox.
 */
export async function ensureCloudflareInbox(options: {
  readonly accountId: string
  readonly apiToken: string
  readonly authEmail?: string | null
  readonly zoneId: string
  readonly fetch?: typeof fetch
}): Promise<ICloudflareInbox> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const headers = cloudflareAuthHeaders(options.apiToken, options.authEmail ?? null)

  try {
    const kvNamespaceId = await ensureKvNamespace(fetchImpl, headers, options.accountId)

    try {
      await uploadInboxWorker(fetchImpl, headers, options.accountId, kvNamespaceId)
      await enableCatchAllWorker(fetchImpl, headers, options.zoneId)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Cloudflare inbox setup failed.'

      console.warn(`Cloudflare inbound mailbox is not fully enabled. ${detail}`)

      return {
        kvNamespaceId,
        warning: `Sent mail is listed from Cloudflare. Inbound Worker is not ready: ${detail}`,
      }
    }

    return { kvNamespaceId, warning: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Cloudflare inbox setup failed.'

    console.warn(`Cloudflare inbound mailbox is not fully enabled. ${detail}`)

    return {
      kvNamespaceId: null,
      warning: `Send list is Cloudflare. Inbound needs Email Routing → Worker. ${detail}`,
    }
  }
}

async function ensureKvNamespace(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  accountId: string,
): Promise<string> {
  const listed = await cfJson(
    fetchImpl,
    headers,
    'GET',
    `/accounts/${accountId}/storage/kv/namespaces?per_page=100`,
  )
  const rows = Array.isArray(listed['result']) ? listed['result'] : []
  const existing = rows.find(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      (item as { title?: unknown }).title === KV_TITLE &&
      typeof (item as { id?: unknown }).id === 'string',
  ) as { id: string } | undefined

  if (existing !== undefined) {
    return existing.id
  }

  const created = await cfJson(
    fetchImpl,
    headers,
    'POST',
    `/accounts/${accountId}/storage/kv/namespaces`,
    { title: KV_TITLE },
  )
  const id = (created['result'] as { id?: unknown } | undefined)?.id

  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Could not create Cloudflare KV namespace etwallet-mailbox.')
  }

  return id
}

async function uploadInboxWorker(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  accountId: string,
  kvNamespaceId: string,
): Promise<void> {
  const listed = await cfJson(
    fetchImpl,
    headers,
    'GET',
    `/accounts/${accountId}/workers/scripts`,
  )
  const scripts = Array.isArray(listed['result']) ? listed['result'] : []
  const alreadyUploaded = scripts.some(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      ((item as { id?: unknown }).id === INBOX_WORKER_NAME ||
        (item as { name?: unknown }).name === INBOX_WORKER_NAME),
  )

  if (alreadyUploaded) {
    return
  }

  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2024-09-23',
    bindings: [
      {
        type: 'kv_namespace',
        name: 'MAILBOX',
        namespace_id: kvNamespaceId,
      },
    ],
  }
  const body = new FormData()

  body.set('metadata', JSON.stringify(metadata))
  body.set(
    'worker.js',
    new File([WORKER_SCRIPT], 'worker.js', { type: 'application/javascript+module' }),
  )

  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${INBOX_WORKER_NAME}`,
    {
      method: 'PUT',
      headers: { ...headers },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  )
  const envelope = (await response.json()) as { success?: boolean; errors?: { message?: string }[] }

  if (envelope.success !== true) {
    throw new Error(envelope.errors?.[0]?.message ?? `Worker upload HTTP ${String(response.status)}`)
  }
}

async function enableCatchAllWorker(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  zoneId: string,
): Promise<void> {
  const current = await cfJson(
    fetchImpl,
    headers,
    'GET',
    `/zones/${zoneId}/email/routing/rules/catch_all`,
  )
  const result = current['result']
  const actions =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as { actions?: unknown; enabled?: unknown }).actions
      : null
  const enabled =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as { enabled?: unknown }).enabled === true
      : false
  const worker =
    Array.isArray(actions) &&
    actions.some(
      (action) =>
        action !== null &&
        typeof action === 'object' &&
        (action as { type?: unknown }).type === 'worker' &&
        Array.isArray((action as { value?: unknown }).value) &&
        ((action as { value: unknown[] }).value.includes(INBOX_WORKER_NAME)),
    )

  if (enabled && worker) {
    return
  }

  const envelope = await cfJson(
    fetchImpl,
    headers,
    'PUT',
    `/zones/${zoneId}/email/routing/rules/catch_all`,
    {
      enabled: true,
      name: 'Email manager inbox',
      matchers: [{ type: 'all' }],
      actions: [{ type: 'worker', value: [INBOX_WORKER_NAME] }],
    },
  )

  if (envelope['success'] !== true) {
    const errors = envelope['errors']
    const message =
      Array.isArray(errors) && errors[0] !== null && typeof errors[0] === 'object'
        ? String((errors[0] as { message?: unknown }).message ?? 'catch-all update failed')
        : 'catch-all update failed'

    throw new Error(message)
  }
}

async function cfJson(
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
  method: string,
  path: string,
  payload?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      ...headers,
      Accept: 'application/json',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let parsed: unknown

  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { success: false, errors: [{ message: `Cloudflare ${path} returned ${String(response.status)}` }] }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Cloudflare ${path} returned a non-JSON body.`)
  }

  return parsed as Record<string, unknown>
}

export async function resolveCloudflareZoneId(options: {
  readonly accountId: string
  readonly apiToken: string
  readonly authEmail?: string | null
  readonly domain: string
  readonly fetch?: typeof fetch
}): Promise<string | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const query = new URLSearchParams({
    'account.id': options.accountId,
    name: options.domain,
  })
  const envelope = await cfJson(
    fetchImpl,
    cloudflareAuthHeaders(options.apiToken, options.authEmail ?? null),
    'GET',
    `/zones?${query.toString()}`,
  )
  const rows = Array.isArray(envelope['result']) ? envelope['result'] : []
  const zone = rows.find(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { id?: unknown }).id === 'string',
  ) as { id: string } | undefined

  return zone?.id ?? null
}
