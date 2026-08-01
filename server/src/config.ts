/**
 * Настройки сервиса из окружения.
 *
 * ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ БЕЗОПАСНЫ ДЛЯ РАЗРАБОТКИ, НО НЕ ДЛЯ БОЯ.
 * Там, где безопасное умолчание невозможно — список разрешённых
 * источников запросов, — сервис отказывается стартовать в боевом
 * режиме без явной настройки. Молчаливое «разрешить всё» в проде
 * хуже отказа: отказ заметят при развёртывании.
 */

/** Режимы работы. */
export const RUNTIME_MODE = {
  Development: 'development',
  Production: 'production',
  Test: 'test',
} as const

export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE]

/** Настройки сервиса. */
export interface IServerConfig {
  readonly mode: RuntimeMode
  readonly host: string
  readonly port: number

  /**
   * Источники, которым разрешены кросс-доменные запросы.
   *
   * Пустой список в режиме разработки означает «любой»; в боевом
   * режиме пустой список — ошибка запуска.
   */
  readonly allowedOrigins: readonly string[]

  /** Предел запросов с одного адреса за окно. */
  readonly rateLimit: {
    readonly max: number
    readonly windowMs: number
  }

  /** Предел размера тела запроса в байтах. */
  readonly maxBodyBytes: number

  /** Сколько секунд клиенту разрешено держать каталог в кэше. */
  readonly catalogCacheSeconds: number
}

const DEFAULT_PORT = 8080
const DEFAULT_RATE_LIMIT_MAX = 120
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Предел тела запроса.
 *
 * Единственный маршрут, принимающий тело, — синхронизация настроек,
 * и она принимает шифротекст. Шестьдесят четыре килобайта хватает
 * с запасом на любые настройки и не хватает на то, чтобы превратить
 * сервис в бесплатное файловое хранилище.
 */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024

const DEFAULT_CATALOG_CACHE_SECONDS = 300

/** Читает число из окружения, отвергая мусор вместо молчаливой подстановки. */
function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]

  if (raw === undefined || raw.trim() === '') {
    return fallback
  }

  const parsed = Number(raw)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Переменная окружения ${name} должна быть положительным числом, получено: ${raw}`,
    )
  }

  return parsed
}

/** Определяет режим работы. */
function readMode(): RuntimeMode {
  const raw = process.env['NODE_ENV'] ?? RUNTIME_MODE.Development

  if (raw === RUNTIME_MODE.Production || raw === RUNTIME_MODE.Test) {
    return raw
  }

  return RUNTIME_MODE.Development
}

/**
 * Собирает настройки из окружения.
 *
 * @throws Error если настройка обязательна в боевом режиме и не задана.
 */
export function loadConfig(): IServerConfig {
  const mode = readMode()

  const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')

  if (mode === RUNTIME_MODE.Production && allowedOrigins.length === 0) {
    throw new Error(
      'В боевом режиме переменная ALLOWED_ORIGINS обязательна. ' +
        'Разрешить запросы с любого источника молча — значит позволить любой странице ' +
        'обращаться к сервису от имени браузера пользователя.',
    )
  }

  return {
    mode,
    host: process.env['HOST'] ?? '127.0.0.1',
    port: readNumber('PORT', DEFAULT_PORT),
    allowedOrigins,
    rateLimit: {
      max: readNumber('RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
      windowMs: readNumber('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS),
    },
    maxBodyBytes: readNumber('MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES),
    catalogCacheSeconds: readNumber('CATALOG_CACHE_SECONDS', DEFAULT_CATALOG_CACHE_SECONDS),
  }
}
