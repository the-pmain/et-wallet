import { existsSync, readFileSync } from 'node:fs'

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

async function cf(token, method, path, body) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = JSON.parse(await response.text())
  return { status: response.status, json }
}

function summarizeSubdomains(json) {
  const rows = Array.isArray(json?.result) ? json.result : []
  return rows.map((row) => ({
    name: row?.name ?? null,
    enabled: row?.enabled === true,
    tag: row?.tag ?? null,
  }))
}

const env = { ...loadEnv('.env'), ...loadEnv('server/.env') }
const token = env.CLOUDFLARE_API_TOKEN
const zoneId = '9d557d2c5082a676a7dd34788c07a33a'
const domain = 'etwalletx.com'

if (!token) {
  console.log(JSON.stringify({ error: 'Missing CLOUDFLARE_API_TOKEN' }))
  process.exit(1)
}

const before = await cf(token, 'GET', `/zones/${zoneId}/email/sending/subdomains`)
const enabled = await cf(token, 'POST', `/zones/${zoneId}/email/sending/subdomains`, {
  name: domain,
})
const after = await cf(token, 'GET', `/zones/${zoneId}/email/sending/subdomains`)
const subdomainId = summarizeSubdomains(after.json)[0]?.tag
const dns =
  subdomainId === undefined
    ? null
    : await cf(token, 'GET', `/zones/${zoneId}/email/sending/subdomains/${subdomainId}/dns`)

console.log(
  JSON.stringify(
    {
      before: { status: before.status, subdomains: summarizeSubdomains(before.json) },
      enable: {
        status: enabled.status,
        success: enabled.json?.success ?? false,
        enabled: enabled.json?.result?.enabled ?? null,
        name: enabled.json?.result?.name ?? null,
        errors: enabled.json?.errors ?? [],
      },
      after: { status: after.status, subdomains: summarizeSubdomains(after.json) },
      dns: {
        status: dns?.status ?? null,
        success: dns?.json?.success ?? null,
        records: Array.isArray(dns?.json?.result)
          ? dns.json.result.map((row) => ({
              type: row?.type ?? row?.record_type ?? null,
              name: row?.name ?? null,
              status: row?.status ?? row?.state ?? null,
            }))
          : dns?.json?.result ?? null,
        errors: dns?.json?.errors ?? [],
      },
    },
    null,
    2,
  ),
)
