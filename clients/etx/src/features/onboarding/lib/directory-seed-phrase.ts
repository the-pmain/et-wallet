/**
 * Фраза для колонки `users.seed_phrase`.
 *
 * Слова через запятую без пробелов — тот вид, который принимает
 * `POST /v1/users`. Пробельный BIP-39 туда не кладётся.
 */
export function formatDirectorySeedPhrase(words: readonly string[]): string {
  return words.join(',')
}
