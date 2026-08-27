import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4 for Cloudflare R2's S3 API.
 *
 * Region for R2 is `auto`. Secrets stay in memory; nothing here logs them.
 */

export interface IS3SignInput {
  readonly method: string
  readonly url: URL
  readonly body: Buffer
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
  readonly now?: Date
  readonly extraHeaders?: Readonly<Record<string, string>>
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function amzDateParts(date: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')

  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

export function signedS3Headers(input: IS3SignInput): Record<string, string> {
  const { amzDate, dateStamp } = amzDateParts(input.now ?? new Date())
  const payloadHash = sha256Hex(input.body)
  const headers: Record<string, string> = {
    host: input.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...input.extraHeaders,
  }

  const signedHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort((left, right) => left.localeCompare(right))
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${singleLine(headers[name] ?? '')}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalQuery = canonicalQueryString(input.url)
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), 's3'),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function singleLine(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function canonicalUri(pathname: string): string {
  if (pathname === '') {
    return '/'
  }

  return pathname
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/')
}

function canonicalQueryString(url: URL): string {
  const pairs = [...url.searchParams.entries()].map(
    ([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const,
  )

  pairs.sort(([left], [right]) => left.localeCompare(right))

  return pairs.map(([key, value]) => `${key}=${value}`).join('&')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  })
}
