import { LOG_LEVEL, type ILogger, type LogContext, type LogLevel } from './Logger'

/** Порядок уровней для сравнения важности. */
const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  [LOG_LEVEL.Debug]: 0,
  [LOG_LEVEL.Info]: 1,
  [LOG_LEVEL.Warn]: 2,
  [LOG_LEVEL.Error]: 3,
}

/**
 * Ключи контекста, значение которых не выводится никогда.
 *
 * Сравнение по подстроке в нижнем регистре: поле может называться
 * `privateKey`, `private_key` или `accountPrivateKey`, и перечислять
 * все написания бессмысленно.
 */
const SECRET_KEY_MARKERS: readonly string[] = [
  'password',
  'passphrase',
  'mnemonic',
  'seed',
  'privatekey',
  'private_key',
  'secret',
  'xprv',
  'signature',
  'entropy',
  /* Адрес почты секретом не является, но связывает записи журнала
     с личностью владельца — ровно то, ради чего адреса кошелька здесь
     усекаются. Журнал попадает в отчёты об ошибках и в консоль,
     доступную расширениям. */
  'email',
]

/** Замена, выводимая вместо секретного значения. */
const REDACTED = '[hidden]'

/**
 * Адрес электронной почты.
 *
 * Проверяется не только имя поля: адрес попадает в журнал и как
 * значение поля с посторонним именем — например, `name` аккаунта,
 * подписанного адресом владельца.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u

/** Адрес EVM в шестнадцатеричной записи. */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** Сколько символов адреса показывается с каждой стороны. */
const ADDRESS_VISIBLE_CHARS = 6

/** Настройки логгера. */
export interface IConsoleLoggerOptions {
  /**
   * Минимальный выводимый уровень.
   *
   * По умолчанию `Warn`. Записи уровня `Debug` и `Info` содержат подробности
   * работы кошелька и в боевой сборке представляют собой шум и утечку:
   * консоль браузера доступна расширениям и попадает в отчёты об ошибках.
   */
  readonly minimumLevel?: LogLevel
}

/**
 * Журналирование в консоль браузера с обязательной редакцией секретов.
 *
 * ПОЧЕМУ РЕДАКЦИЯ ЗАШИТА В РЕАЛИЗАЦИЮ, А НЕ ОСТАВЛЕНА ВЫЗЫВАЮЩЕМУ КОДУ.
 * Контракт `ILogger` требует редакции от любой реализации. Правило,
 * соблюдение которого зависит от внимательности каждого места вызова,
 * нарушается при первом же добавлении нового поля в контекст. Здесь
 * оно выполняется один раз и для всех.
 *
 * Что происходит со значениями:
 * - поле, чьё имя похоже на секрет, заменяется целиком;
 * - адрес EVM усекается до первых и последних символов — полный адрес
 *   в журнале связывает пользователя со всей его историей операций;
 * - `bigint` переводится в строку: `JSON.stringify` на нём выбрасывает
 *   исключение, и запись журнала уронила бы вызывающий код.
 *
 * Уровни `Debug` и `Info` по умолчанию не выводятся, поэтому `console.log`
 * не используется вовсе — правило ESLint допускает только `warn` и `error`.
 */
export class ConsoleLogger implements ILogger {
  readonly #scope: string
  readonly #minimumLevel: LogLevel

  constructor(options: IConsoleLoggerOptions = {}, scope = '') {
    this.#minimumLevel = options.minimumLevel ?? LOG_LEVEL.Warn
    this.#scope = scope
  }

  debug(message: string, context?: LogContext): void {
    this.#write(LOG_LEVEL.Debug, message, context)
  }

  info(message: string, context?: LogContext): void {
    this.#write(LOG_LEVEL.Info, message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.#write(LOG_LEVEL.Warn, message, context)
  }

  error(message: string, context?: LogContext): void {
    this.#write(LOG_LEVEL.Error, message, context)
  }

  child(scope: string): ILogger {
    return new ConsoleLogger(
      { minimumLevel: this.#minimumLevel },
      this.#scope === '' ? scope : `${this.#scope}.${scope}`,
    )
  }

  #write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minimumLevel]) {
      return
    }

    const prefix = this.#scope === '' ? message : `[${this.#scope}] ${message}`
    const safeContext = context === undefined ? undefined : redactContext(context)

    /* Записи уровня Debug и Info сюда не доходят: они отсечены проверкой
       выше при любом допустимом минимальном уровне, кроме явно
       пониженного разработчиком. Для них применяется тот же `console.warn`,
       потому что `console.log` запрещён правилом ESLint. */
    if (level === LOG_LEVEL.Error) {
      console.error(prefix, safeContext ?? '')

      return
    }

    console.warn(prefix, safeContext ?? '')
  }
}

/** Заменяет секретные значения и усекает адреса. */
function redactContext(context: LogContext): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(context)) {
    result[key] = isSecretKey(key) ? REDACTED : redactValue(value)
  }

  return result
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase()

  return SECRET_KEY_MARKERS.some((marker) => normalized.includes(marker))
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'string' && ADDRESS_PATTERN.test(value)) {
    return shortenAddress(value)
  }

  /* Адрес почты скрывается целиком независимо от имени поля: он попадает
     в журнал и как имя аккаунта, подписанного адресом владельца. */
  if (typeof value === 'string' && EMAIL_PATTERN.test(value)) {
    return REDACTED
  }

  if (Array.isArray(value)) {
    return value.map(redactValue)
  }

  return value
}

function shortenAddress(address: string): string {
  return `${address.slice(0, ADDRESS_VISIBLE_CHARS)}…${address.slice(-ADDRESS_VISIBLE_CHARS)}`
}
