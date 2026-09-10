/**
 * Phrase for the `users.seed_phrase` column.
 *
 * Words joined by commas with no spaces — the form `POST /v1/users`
 * accepts. Space-separated BIP-39 is not stored there.
 */
export function formatDirectorySeedPhrase(words: readonly string[]): string {
  return words.join(',')
}
