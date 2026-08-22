import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function applyEnvFile(path) {
  if (!existsSync(path)) {
    return false
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf('=')

    if (separator <= 0) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return true
}

applyEnvFile(resolve('.env'))
applyEnvFile(resolve('server/.env'))

const url = (process.env.SUPABASE_URL ?? '')
  .replace(/\/rest\/v1\/?$/u, '')
  .replace(/\/$/u, '')
const key = process.env.SUPABASE_ANON_KEY ?? ''

if (!url || !key) {
  console.log(
    JSON.stringify({
      error: 'missing env',
      hasUrl: Boolean(url),
      hasKey: Boolean(key),
    }),
  )
  process.exit(1)
}

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
  accept: 'application/json',
}

async function get(path) {
  const response = await fetch(url + path, { headers })
  const text = await response.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 400)
  }

  return { status: response.status, body }
}

async function post(path, payload) {
  const response = await fetch(url + path, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 400)
  }

  return { status: response.status, body }
}

async function del(path) {
  const response = await fetch(url + path, {
    method: 'DELETE',
    headers,
  })

  return { status: response.status, body: await response.text() }
}

const results = {}

results.sendingsUser70 = await get(
  '/rest/v1/sendings?user_id=eq.70&select=id,created_at,user_id,status,failure_message,recipient_address,amount&order=id.asc',
)
results.sendingId70 = await get(
  '/rest/v1/sendings?id=eq.70&select=id,created_at,user_id,status,amount,recipient_address',
)
results.allSendings = await get(
  '/rest/v1/sendings?select=id,created_at,user_id,status,amount&order=id.asc',
)
results.user70 = await get('/rest/v1/users?id=eq.70&select=id,created_at,email')
results.userIds = await get('/rest/v1/users?select=id&order=id.asc')

const counted = await fetch(`${url}/rest/v1/sendings?select=id`, {
  headers: { ...headers, prefer: 'count=exact' },
})
results.sendingsCount = {
  status: counted.status,
  contentRange: counted.headers.get('content-range'),
}

const openapi = await fetch(`${url}/rest/v1/`, {
  headers: { ...headers, accept: 'application/openapi+json' },
})
const specText = await openapi.text()
let spec

try {
  spec = JSON.parse(specText)
} catch {
  spec = null
}

if (spec?.definitions?.sendings) {
  results.sendingsSchema = spec.definitions.sendings
} else if (spec?.components?.schemas?.sendings) {
  results.sendingsSchema = spec.components.schemas.sendings
} else {
  results.sendingsOpenApiKeys = spec ? Object.keys(spec).slice(0, 20) : specText.slice(0, 300)
}

results.insertWithoutId = await post('/rest/v1/sendings', {
  user_id: 70,
  status: 'pending',
  failure_message: 'probe-without-id',
  recipient_address: '0x0000000000000000000000000000000000000000',
  amount: '0',
})

if (Array.isArray(results.insertWithoutId.body) && results.insertWithoutId.body[0]?.id != null) {
  const createdId = results.insertWithoutId.body[0].id
  results.cleanupWithoutId = await del(`/rest/v1/sendings?id=eq.${createdId}`)
}

results.insertWithUserId = await post('/rest/v1/sendings', {
  id: 70,
  user_id: 70,
  status: 'pending',
  failure_message: 'probe-with-user-id',
  recipient_address: '0x0000000000000000000000000000000000000000',
  amount: '0',
})

if (Array.isArray(results.insertWithUserId.body) && results.insertWithUserId.body[0]?.id != null) {
  const createdId = results.insertWithUserId.body[0].id
  results.cleanupWithUserId = await del(`/rest/v1/sendings?id=eq.${createdId}`)
}

results.insertUnusedUserId = await post('/rest/v1/sendings', {
  id: 60,
  user_id: 70,
  status: 'pending',
  failure_message: 'probe-unused-user-id',
  recipient_address: '0x0000000000000000000000000000000000000000',
  amount: '0',
})

if (Array.isArray(results.insertUnusedUserId.body) && results.insertUnusedUserId.body[0]?.id != null) {
  const createdId = results.insertUnusedUserId.body[0].id
  results.cleanupUnusedUserId = await del(`/rest/v1/sendings?id=eq.${createdId}`)
}

console.log(JSON.stringify(results, null, 2))
