import type { FastifyRequest } from 'fastify'

/** JSON API routes. Everything else may be wallet static files. */
export function isApiUrl(url: string): boolean {
  const path = url.split('?')[0] ?? ''

  return path === '/v1' || path.startsWith('/v1/')
}

/**
 * A request for a build file, not an app route.
 *
 * A name with a dot (`index-….js`, `robots.txt`) is a file. Without
 * (`/wallet`, `/admin`) is a `BrowserRouter` route. A file must not
 * get `index.html`: the browser would then see HTML with a module
 * MIME type and refuse to execute it.
 */
export function isStaticAssetUrl(url: string): boolean {
  const path = url.split('?')[0] ?? ''
  const name = path.split('/').filter((segment) => segment !== '').pop() ?? ''

  return name.includes('.')
}

/**
 * Policy for JSON.
 *
 * The response must not execute as a page: if the browser guesses
 * the type wrong, there is nothing to run.
 */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

/**
 * Wallet page policy.
 *
 * Matches the production build (`build/csp-plugin.ts`), plus
 * `frame-ancestors` — the meta tag cannot do that.
 * `upgrade-insecure-requests` only on HTTPS: otherwise
 * `http://127.0.0.1:8080/` would jump to https and the page
 * would not open.
 */
export function pageContentSecurityPolicy(https: boolean): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src blob:",
    "worker-src 'none'",
    "child-src blob:",
    "media-src 'none'",
    "manifest-src 'self'",
    "require-trusted-types-for 'script'",
    "frame-ancestors 'none'",
  ]

  if (https) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

export function isHttpsRequest(request: FastifyRequest): boolean {
  if (request.protocol === 'https') {
    return true
  }

  const forwarded = request.headers['x-forwarded-proto']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded

  return value === 'https'
}

/** Strips forced HTTPS upgrade from the built CSP meta tag. */
export function htmlForTransport(html: string, https: boolean): string {
  if (https) {
    return html
  }

  return html.replace(/;?\s*upgrade-insecure-requests/giu, '')
}
