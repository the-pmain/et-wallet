import type { ISecretBuffer } from './types'

/**
 * Runs an action on a secret and wipes it afterwards, including on throw.
 *
 * WHY A HELPER INSTEAD OF INLINE `try/finally`. Secrets are created and
 * must be wiped in more than a dozen places: key derivation, signing,
 * export, import. A forgotten `finally` is neither a compile error nor a
 * test failure — it leaves the key in memory, and the only way to notice
 * is by reading the code. The helper turns the rule into a construct:
 * wiping happens because otherwise the result is unreachable.
 *
 * WIPING RUNS ON EXCEPTION TOO. Failures mid-key-use are normal: the
 * node did not answer, signing failed. Leaving the secret in memory
 * then would mean the protection works only when everything goes well.
 *
 * WHAT THIS DOES NOT DO. It does not stop the called code from keeping
 * a reference to the buffer or turning it into a string. A JavaScript
 * string cannot be wiped — it lives until garbage collection — and that
 * is a runtime limit, not an omission here.
 */
export async function withSecret<TSecret extends ISecretBuffer, TResult>(
  secret: TSecret,
  action: (secret: TSecret) => Promise<TResult> | TResult,
): Promise<TResult> {
  try {
    return await action(secret)
  } finally {
    secret.wipe()
  }
}

/**
 * Synchronous variant.
 *
 * A separate function, not a result-type check: async work accidentally
 * passed here would be wiped before it finished — signing would get a
 * zeroed key. The split makes that mistake a compile error.
 */
export function withSecretSync<TSecret extends ISecretBuffer, TResult>(
  secret: TSecret,
  action: (secret: TSecret) => TResult,
): TResult {
  try {
    return action(secret)
  } finally {
    secret.wipe()
  }
}
