import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Корень раздачи интерфейса.
 *
 * Каталог обязан содержать `index.html`. Без него сервис остаётся
 * JSON-only: отсутствие сборки кошелька не должно ронять API.
 *
 * `searchDefaults: false` в тестах: иначе локальный `dist` менял бы
 * ответы `GET /` и ломал бы проверки, которые ждут JSON 404.
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
    throw new Error(`STATIC_ROOT не содержит index.html: ${options.configured}`)
  }

  return null
}
