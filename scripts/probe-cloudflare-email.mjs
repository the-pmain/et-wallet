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
  {
    name: 'Email Sending — list history (does not exist)',
    path: `/accounts/${accountId}/email/sending/history`,
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
      resultCount: Array.isArray(json?.result) ? json.result.length : null,
      errors: json?.errors ?? null,
      sample: Array.isArray(json?.result) ? json.result.slice(0, 5) : json?.result ?? null,
    })
  } catch (error) {
    results.push({
      name: probe.name,
      path: probe.path,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Local app store (Supabase or memory on running server)
let localMessages = null
const supabaseUrl = env.SUPABASE_URL?.replace(/\/$/u, '')
const supabaseKey = env.SUPABASE_ANON_KEY
if (supabaseUrl && supabaseKey) {
  try {
    const endpoint = new URL(`${supabaseUrl}/rest/v1/emails`)
    endpoint.searchParams.set('select', 'id,created_at,direction,from_addr,to_addr,subject,status')
    endpoint.searchParams.set('order', 'created_at.desc')
    endpoint.searchParams.set('limit', '50')
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    })
    const text = await response.text()
    localMessages = {
      source: 'Supabase public.emails',
      status: response.status,
      rows: response.ok ? JSON.parse(text) : text.slice(0, 300),
    }
  } catch (error) {
    localMessages = {
      source: 'Supabase public.emails',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

console.log(
  JSON.stringify(
    {
      summary:
        'Cloudflare Email Sending has no API to list sent/received mail. Only routing config and your own DB (Supabase) hold history.',
      cloudflare: results,
      localStore: localMessages,
    },
    null,
    2,
  ),
)
