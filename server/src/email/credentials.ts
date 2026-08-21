/**
 * Различает ключ Cloudflare и токен.
 *
 * С апреля 2026 глобальный ключ начинается с `cfk_`, токены — с
 * `cfut_` / `cfat_`. Email Sending принимает глобальный ключ только
 * как пару `X-Auth-Email` + `X-Auth-Key`. Тот же секрет в
 * `Authorization: Bearer` Cloudflare отвергает как
 * «Authentication error» — до проверки права на отправку.
 */

const GLOBAL_KEY_PREFIX = 'cfk_'
const LEGACY_GLOBAL_KEY = /^[0-9a-f]{37,45}$/u

export function isCloudflareGlobalApiKey(secret: string): boolean {
  return secret.startsWith(GLOBAL_KEY_PREFIX) || LEGACY_GLOBAL_KEY.test(secret)
}
