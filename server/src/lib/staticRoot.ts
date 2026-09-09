import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI static root.
 *
 * The directory must contain `index.html`. Without it the service
 * stays JSON-only: a missing wallet build must not take down the API.
 *
 * `searchDefaults: false` in tests: otherwise a local `dist` would
 * change `GET /` responses and break checks that expect JSON 404.
 */
export function resolveStaticRoot(options: {
  readonly configured: string | null
  readonly searchDefaults: boolean
}): string | null {
  const candidates: string[] = []

  if (options.configured !== null) {
    candidates.push(
      isAbsolute(options.configured)
        ? options.configured
        : resolve(process.cwd(), options.configured),
    )
  }

  if (options.searchDefaults) {
    const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

    candidates.push(join(serverRoot, 'public'), join(serverRoot, '../dist'))
  }

  for (const directory of candidates) {
    if (existsSync(join(directory, 'index.html'))) {
      return directory
    }
  }

  if (options.configured !== null) {
    throw new Error(`STATIC_ROOT does not contain index.html: ${options.configured}`)
  }

  return null
}
