/**
 * Distinguishes a Cloudflare key from a token.
 *
 * From April 2026 a global key starts with `cfk_`, tokens with
 * `cfut_` / `cfat_`. Email Sending accepts a global key only as
 * `X-Auth-Email` + `X-Auth-Key`. The same secret in
 * `Authorization: Bearer` is rejected by Cloudflare as
 * "Authentication error" — before send permission is checked.
 */

const GLOBAL_KEY_PREFIX = 'cfk_'
const LEGACY_GLOBAL_KEY = /^[0-9a-f]{37,45}$/u

export function isCloudflareGlobalApiKey(secret: string): boolean {
  return secret.startsWith(GLOBAL_KEY_PREFIX) || LEGACY_GLOBAL_KEY.test(secret)
}

export function cloudflareAuthHeaders(
  secret: string,
  authEmail: string | null,
): Record<string, string> {
  if (isCloudflareGlobalApiKey(secret)) {
    return {
      'X-Auth-Email': authEmail ?? '',
      'X-Auth-Key': secret,
    }
  }

  return {
    Authorization: `Bearer ${secret}`,
  }
}
