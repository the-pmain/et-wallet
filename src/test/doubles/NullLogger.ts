import type { ILogger, LogContext, LogLevel } from '@/core'

export interface ILogRecord {
  readonly level: LogLevel
  readonly scope: string
  readonly message: string
  readonly context: LogContext | undefined
}

/**
 * Logger that accumulates records instead of printing.
 *
 * Not just a stub: the collected records let a test prove that
 * secrets did not reach the log. That check must exist in tests
 * of modules that handle keys.
 */
export class NullLogger implements ILogger {
  readonly records: ILogRecord[] = []

  readonly #scope: string

  constructor(scope = 'root') {
    this.#scope = scope
  }

  debug(message: string, context?: LogContext): void {
    this.#write('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.#write('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.#write('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.#write('error', message, context)
  }

  child(scope: string): ILogger {
    const child = new NullLogger(`${this.#scope}.${scope}`)

    /* Shared record array: the test inspects the whole log,
       not by collecting children. */
    Object.defineProperty(child, 'records', { value: this.records })

    return child
  }

  #write(level: LogLevel, message: string, context: LogContext | undefined): void {
    this.records.push({ level, scope: this.#scope, message, context })
  }
}
