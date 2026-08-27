import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv(path) {
  const env = {}
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf('=')
    if (sep <= 0) continue
    let value = trimmed.slice(sep + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[trimmed.slice(0, sep).trim()] = value
  }
  return env
}

function mergeEnv(base, overlay) {
  return { ...base, ...overlay }
}

async function cfFetch(token, path, email) {
  const headers = { Accept: 'application/json' }
  if (token.startsWith('cfk_')) {
    if (!email) throw new Error('Global API key requires CLOUDFLARE_EMAIL')
    headers['X-Auth-Email'] = email
    headers['X-Auth-Key'] = token
  } else {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { status: response.status, json }
}

const env = mergeEnv(loadEnv('.env'), loadEnv('server/.env'))
const accountId = env.CLOUDFLARE_ACCOUNT_ID
const token = env.CLOUDFLARE_API_TOKEN
const email = env.CLOUDFLARE_EMAIL

if (!accountId || !token) {
  console.log(JSON.stringify({ error: 'Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in server/.env' }, null, 2))
  process.exit(1)
}

const probes = [
  {
    name: 'Verify token',
    path: '/user/tokens/verify',
    note: 'Confirms the API token is valid',
  },
  {
    name: 'List zones',
    path: `/zones?account.id=${accountId}`,
    note: 'Domains on this account — needed for Email Sending subdomains',
  },
  {
    name: 'R2 buckets',
    path: `/accounts/${accountId}/r2/buckets`,
    note: 'Object storage for the mailbox archive',
  },
  {
    name: 'Email Routing destination addresses',
    path: `/accounts/${accountId}/email/routing/addresses`,
    note: 'Verified forward targets — not message bodies',
  },
  {
    name: 'Email Routing rules (account)',
    path: `/accounts/${accountId}/email/routing/rules`,
    note: 'Routing rules — not message bodies',
  },
  {
    name: 'Email Sending — list messages (does not exist)',
    path: `/accounts/${accountId}/email/sending/messages`,
    note: 'Expected 404/405 — Cloudflare has no inbox API',
  },
]

const results = []

for (const probe of probes) {
  try {
    const { status, json } = await cfFetch(token, probe.path, email)
    results.push({
      name: probe.name,
      path: probe.path,
      status,
      note: probe.note,
      success: json?.success ?? null,
      resultCount: Array.isArray(json?.result) ? json.result.length : json?.result?.buckets?.length ?? null,
      errors: json?.errors ?? null,
      sample: Array.isArray(json?.result)
        ? json.result.slice(0, 5)
        : json?.result?.buckets
          ? json.result.buckets.slice(0, 5)
          : json?.result ?? null,
    })

    if (probe.name === 'List zones' && Array.isArray(json?.result)) {
      for (const zone of json.result.slice(0, 10)) {
        const zoneId = zone?.id
        const zoneName = zone?.name
        if (!zoneId) continue
        const sub = await cfFetch(token, `/zones/${zoneId}/email/sending/subdomains`, email)
        results.push({
          name: `Email Sending subdomains (${zoneName})`,
          path: `/zones/${zoneId}/email/sending/subdomains`,
          status: sub.status,
          note: 'From addresses must be on an enabled sending subdomain',
          success: sub.json?.success ?? null,
          resultCount: Array.isArray(sub.json?.result) ? sub.json.result.length : null,
          errors: sub.json?.errors ?? null,
          sample: Array.isArray(sub.json?.result) ? sub.json.result.slice(0, 5) : sub.json?.result ?? null,
        })
      }
    }
  } catch (error) {
    results.push({
      name: probe.name,
      path: probe.path,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const mailboxQuery = `
query Mailbox($zoneTag: string!, $start: Time!, $end: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      emailSendingAdaptive(
        filter: { datetime_geq: $start, datetime_leq: $end }
        limit: 20
        orderBy: [datetime_DESC]
      ) { datetime from to subject status eventType messageId }
      emailRoutingAdaptive(
        filter: { datetime_geq: $start, datetime_leq: $end }
        limit: 20
        orderBy: [datetime_DESC]
      ) { datetime from to subject status action messageId }
    }
  }
}`

const end = new Date()
const start = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000)
const mailbox = []
const zonesProbe = results.find((item) => item.name === 'List zones')
const zones = Array.isArray(zonesProbe?.sample) ? zonesProbe.sample : []

for (const zone of zones.slice(0, 5)) {
  if (!zone?.id) continue
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (token.startsWith('cfk_')) {
    headers['X-Auth-Email'] = email
    headers['X-Auth-Key'] = token
  } else {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: mailboxQuery,
      variables: { zoneTag: zone.id, start: start.toISOString(), end: end.toISOString() },
    }),
  })
  const json = await response.json()
  mailbox.push({
    zone: zone.name,
    zoneId: zone.id,
    status: response.status,
    errors: json?.errors ?? null,
    sending: json?.data?.viewer?.zones?.[0]?.emailSendingAdaptive ?? null,
    routing: json?.data?.viewer?.zones?.[0]?.emailRoutingAdaptive ?? null,
  })
}

console.log(
  JSON.stringify(
    {
      summary:
        'Send via Cloudflare Email Sending REST. GET /v1/admin/email/messages lists Cloudflare GraphQL activity logs (emailSendingAdaptive + emailRoutingAdaptive), not Supabase public.emails.',
      cloudflare: results,
      mailbox,
    },
    null,
    2,
  ),
)
