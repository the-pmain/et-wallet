import type { Plugin } from 'vite'

/**
 * Content-Security-Policy for the production build.
 *
 * Directives are intentionally narrow:
 * - `script-src 'self'`   — only bundle code runs. Any inline script
 *                           injected via XSS is blocked by the browser.
 * - `object-src 'none'`   — no plugins (Flash, PDF-embed, and the like).
 * - `base-uri 'self'`     — blocks base-URL swap (base-tag injection).
 *
 * `style-src` must include `'unsafe-inline'`: Radix UI and Tailwind
 * animations set inline styles via the `style` attribute. That does
 * not execute code, but CSS injection would need a revisit.
 *
 * `connect-src` ALLOWS ANY HTTPS BY DEFAULT, A DELIBERATE TRADE.
 * The user may point at their own RPC node — an address unknown at
 * build time. A list built from built-in networks would cancel that,
 * and that is the main request-privacy defense: without their own
 * node, the foreign operator sees the IP and every owner address.
 *
 * THE HOST MAY CHOOSE OTHERWISE. Build variable
 * `VITE_CSP_CONNECT_SRC` sets the source list explicitly — e.g. for
 * a host that does not expect a custom node, where blocking arbitrary
 * destinations matters more. The one who serves the build chooses,
 * because they bear the consequences.
 *
 * `https:` also covers `wss:`: the CSP spec maps the `https` scheme
 * to secure websockets. A separate entry is not needed, and its
 * absence does not mean WalletConnect is banned.
 */

const DEFAULT_CONNECT_SRC = "'self' https:"

export function buildContentSecurityPolicy(connectSrc: string = DEFAULT_CONNECT_SRC): string {
  return [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    /* blob: — mail preview in an iframe without srcDoc (Trusted Types). */
    "frame-src blob:",
    /*
    The app has no workers. Allowing `blob:` would let a worker run
    code built from a string — a bypass of `script-src 'self'`, which
    is why the policy exists.
  */
    "worker-src 'none'",
    /* The app does not embed foreign pages. blob: is for the same
     mail preview as frame-src. */
    "child-src blob:",
    "media-src 'none'",
    "manifest-src 'self'",
    /*
    Trusted Types block assigning strings into sinks that execute
    code: `innerHTML`, script `src`, `eval`. The ESLint rule against
    `innerHTML` covers our code; this directive also covers
    dependencies, including ones that arrive later.

    A `dompurify` policy is omitted on purpose: the app has no markup
    sanitizer, and allowing one in advance would open a path nobody
    uses.
  */
    "require-trusted-types-for 'script'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/**
 * Injects the CSP meta tag into index.html on production builds only.
 *
 * Why only production: Vite's dev server uses inline scripts and a
 * WebSocket for HMR — a strict policy breaks development. Splitting
 * by command keeps the production policy strict without hurting DX.
 *
 * IMPORTANT: the meta tag does not support `frame-ancestors` or
 * `report-*`. Clickjacking defense must also come from host HTTP
 * headers (`Content-Security-Policy`, `X-Frame-Options: DENY`).
 */
export function cspPlugin(): Plugin {
  return {
    name: 'wallet:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        /* An empty variable means "unset", not "forbid everything":
           an empty `connect-src` would cut the wallet off every node,
           and that would be noticed only after deploy. */
        const configured = process.env['VITE_CSP_CONNECT_SRC']?.trim()
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildContentSecurityPolicy(
                configured === undefined || configured === '' ? undefined : configured,
              ),
            },
            injectTo: 'head-prepend' as const,
          },
        ]
      },
    },
  }
}
