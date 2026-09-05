/**
 * Signs of data the service must never hold.
 *
 * WHY THIS EXISTS IF NO ROUTE ACCEPTS THAT. Because "no route" is a
 * claim about today's code. A route added in six months may accept a
 * field nobody thought of; a buggy client may send the wrong thing.
 * An inbound check turns "the service does not receive secrets" from
 * intent into behavior: such a request is rejected before parse and
 * never reaches the log or storage.
 *
 * THIS IS NOT PROTECTING THE USER FROM THEMSELVES. A secret that went
 * on the wire is already compromised — a proxy saw it, the TLS
 * terminator saw it. The check limits the damage and, more important,
 * makes the mistake visible immediately, not a year later in logs.
 */

/** EVM private key: 32 bytes, hex. */
const PRIVATE_KEY_PATTERN = /\b(0x)?[0-9a-fA-F]{64}\b/u

/**
 * Twelve or more lowercase Latin words separated by spaces.
 *
 * The BIP-39 wordlist is not pulled in on purpose: it weighs hundreds
 * of kilobytes, and "twelve short words in a row" catches a mnemonic
 * just as well. A false hit on prose is possible, but no field in this
 * service accepts long text.
 */
const MNEMONIC_PATTERN = /\b([a-z]{3,8}\s+){11,}[a-z]{3,8}\b/u

/** What was recognized in the inbound data. */
export const SECRET_KIND = {
  PrivateKey: 'private-key',
  Mnemonic: 'mnemonic',
} as const

export type SecretKind = (typeof SECRET_KIND)[keyof typeof SECRET_KIND]

/**
 * Looks for secret-like data in inbound text.
 *
 * @returns What was recognized, or `null` if nothing matched.
 */
export function findSecretKind(payload: string): SecretKind | null {
  if (PRIVATE_KEY_PATTERN.test(payload)) {
    return SECRET_KIND.PrivateKey
  }

  if (MNEMONIC_PATTERN.test(payload)) {
    return SECRET_KIND.Mnemonic
  }

  return null
}
