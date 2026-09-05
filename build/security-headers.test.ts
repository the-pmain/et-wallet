import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildContentSecurityPolicy } from './csp-plugin'
import {
  ROBOTS_TAG_VALUE,
  buildNetlifyHeaders,
  buildNginxSnippet,
  buildSecurityHeaders,
} from './security-headers-plugin'


function header(name: string, connectSrc?: string): string {
  return buildSecurityHeaders(connectSrc).find((entry) => entry.name === name)?.value ?? ''
}

describe('Connect policy', () => {
  it('by default allows any HTTPS', () => {
    /* The user may point at their own node, and its address is
       unknown at build time. A list of built-in networks would
       cancel the main request-privacy defense. */
    expect(buildContentSecurityPolicy()).toContain("connect-src 'self' https:")
  })

  it('the host may set the source list explicitly', () => {
    /* A host that does not expect a custom node may forbid requests
       to arbitrary addresses. */
    const policy = buildContentSecurityPolicy("'self' https://eth.example")

    expect(policy).toContain("connect-src 'self' https://eth.example")
    expect(policy).not.toContain('connect-src ;')
  })

  it('the source list reaches the headers too', () => {
    /* The meta tag and the header must say the same thing: otherwise
       the live policy would differ from the one that was checked. */
    expect(header('Content-Security-Policy', "'self' https://eth.example")).toContain(
      'https://eth.example',
    )
  })
})

describe('Host headers', () => {
  it('forbid framing on a foreign page', () => {
    /* The meta tag ignores `frame-ancestors`: without the header the
       wallet can be placed in an invisible frame over a foreign page,
       and the signature would be made on someone else's button. */
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(header('X-Frame-Options')).toBe('DENY')
  })

  it('keep camera and HID access', () => {
    /* The camera reads a connect link, HID talks to a hardware wallet.
       Close them in the policy and both features would silently stop. */
    const policy = header('Permissions-Policy')

    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('hid=(self)')
  })

  it('close what the wallet does not use', () => {
    const policy = header('Permissions-Policy')

    expect(policy).toContain('geolocation=()')
    expect(policy).toContain('microphone=()')
    expect(policy).toContain('payment=()')
  })

  it('require HTTPS for a long time and for subdomains', () => {
    /* Intercepting the first HTTP request swaps the whole page, and
       the page is the wallet. */
    const policy = header('Strict-Transport-Security')

    expect(policy).toContain('includeSubDomains')
    expect(policy).toContain('preload')
    expect(Number(/max-age=(\d+)/u.exec(policy)?.[1] ?? '0')).toBeGreaterThanOrEqual(31_536_000)
  })

  it('do not send the page URL to foreign servers', () => {
    expect(header('Referrer-Policy')).toBe('no-referrer')
  })

  it('forbid content-type sniffing', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
  })

  it('forbid search-engine indexing', () => {
    /* Only robots that loaded HTML see the meta tag. The header
       covers JSON, scripts and icons — everything the host serves. */
    expect(header('X-Robots-Tag')).toBe(ROBOTS_TAG_VALUE)
  })

  it('the meta tag and robots.txt say the same as the header', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    const robots = readFileSync(join(process.cwd(), 'public/robots.txt'), 'utf8')

    expect(html).toContain(`content="${ROBOTS_TAG_VALUE}"`)
    expect(robots).toMatch(/^User-agent:\s*\*/mu)
    expect(robots).toMatch(/^Disallow: \/$/mu)
  })
})

describe('Host config files', () => {
  it('`_headers` contains every header', () => {
    const file = buildNetlifyHeaders()

    for (const entry of buildSecurityHeaders()) {
      expect(file).toContain(`${entry.name}: ${entry.value}`)
    }
  })

  it('the entry is not cached, build files are cached forever', () => {
    /* A long-cached `index.html` would leave the user on the previous
       build — including one with a fixed hole. */
    const file = buildNetlifyHeaders()

    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
    expect(file).toContain('/index.html\n  Cache-Control: no-cache')
  })

  it('in the nginx snippet every header is marked `always`', () => {
    /* Without this word the header is omitted on error responses, and
       an error page is still a page. */
    const file = buildNginxSnippet()

    for (const line of file.split('\n').filter((entry) => entry.startsWith('add_header'))) {
      expect(line.endsWith('always;')).toBe(true)
    }
  })

  it('both files describe the same policy', () => {
    /* Two hand-written lists diverge on the first change, and the
       divergence is silent. */
    const policy = header('Content-Security-Policy')

    expect(buildNetlifyHeaders()).toContain(policy)
    expect(buildNginxSnippet()).toContain(policy)
  })
})
