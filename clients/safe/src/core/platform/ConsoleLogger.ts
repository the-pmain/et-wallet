import { LOG_LEVEL, type ILogger, type LogContext, type LogLevel } from './Logger'

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  [LOG_LEVEL.Debug]: 0,
  [LOG_LEVEL.Info]: 1,
  [LOG_LEVEL.Warn]: 2,
  [LOG_LEVEL.Error]: 3,
}

/**
 * Context keys whose value is never printed.
 *
 * Compared as a lower-case substring: a field may be named
 * `privateKey`, `private_key`, or `accountPrivateKey`, and listing
 * every spelling is pointless.
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
  /* An email address is not a secret, but it ties log entries to
     the owner's identity — exactly why wallet addresses are
     truncated here. The log ends up in error reports and in a
     console that extensions can read. */
  'email',
]

const REDACTED = '[hidden]'

/**
 * Email address.
 *
 * Not only the field name is checked: an address also lands in the
 * log as the value of an unrelated field — for example the `name`
 * of an account labelled with the owner's address.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

/** How many address characters are shown on each side. */
const ADDRESS_VISIBLE_CHARS = 6

export interface IConsoleLoggerOptions {
  /**
   * Minimum level that is printed.
   *
   * Default `Warn`. `Debug` and `Info` entries contain wallet
   * internals and in a production build are both noise and a leak:
   * the browser console is available to extensions and ends up in
   * error reports.
   */
  readonly minimumLevel?: LogLevel
}

/**
 * Browser-console logging with mandatory redaction of secrets.
 *
 * WHY REDACTION IS BUILT INTO THE IMPLEMENTATION, NOT LEFT TO THE
 * CALLER. The `ILogger` contract requires redaction of every
 * implementation. A rule that depends on every call site being
 * careful is broken the first time a new field is added to the
 * context. Here it is applied once, for everyone.
 *
 * What happens to values:
 * - a field whose name looks like a secret is replaced entirely;
 * - an EVM address is truncated to the first and last characters —
 *   a full address in the log ties the user to their whole history;
 * - `bigint` is turned into a string: `JSON.stringify` throws on
 *   it, and a log write would crash the caller.
 *
 * `Debug` and `Info` are not printed by default, so `console.log`
 * is not used at all — the ESLint rule allows only `warn` and
 * `error`.
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

    /* Debug and Info entries do not reach here: they are cut by the
       check above at every allowed minimum level except one the
       developer has explicitly lowered. The same `console.warn` is
       used for them because `console.log` is forbidden by ESLint. */
    if (level === LOG_LEVEL.Error) {
      console.error(prefix, safeContext ?? '')

      return
    }

    console.warn(prefix, safeContext ?? '')
  }
}

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

  /* An email is hidden entirely regardless of the field name: it
     also lands in the log as the name of an account labelled with
     the owner's address. */
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
