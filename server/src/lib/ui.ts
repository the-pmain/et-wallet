import type { FastifyRequest } from 'fastify'

/** Маршруты JSON-API. Остальное может быть статикой кошелька. */
export function isApiUrl(url: string): boolean {
  const path = url.split('?')[0] ?? ''

  return path === '/v1' || path.startsWith('/v1/')
}

/**
 * Политика для JSON.
 *
 * Ответ не должен исполняться как страница: если браузер ошибётся
 * типом, исполнять в нём будет нечего.
 */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

/**
 * Политика страницы кошелька.
 *
 * Совпадает с production-сборкой (`build/csp-plugin.ts`), плюс
 * `frame-ancestors` — её метатег не умеет. `upgrade-insecure-requests`
 * только на HTTPS: иначе `http://127.0.0.1:8080/` уехал бы на https
 * и страница не открылась бы.
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

/** Убирает принудительный переход на HTTPS из метатега CSP сборки. */
export function htmlForTransport(html: string, https: boolean): string {
  if (https) {
    return html
  }

  return html.replace(/;?\s*upgrade-insecure-requests/giu, '')
}
