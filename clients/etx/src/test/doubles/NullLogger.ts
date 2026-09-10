import type { ILogger, LogContext, LogLevel } from '@/core'

/** Запись, зафиксированная логгером. */
export interface ILogRecord {
  readonly level: LogLevel
  readonly scope: string
  readonly message: string
  readonly context: LogContext | undefined
}

/**
 * Логгер, накапливающий записи вместо вывода.
 *
 * Не просто заглушка: собранные записи позволяют проверить, что в журнал
 * не попали секреты. Такая проверка обязана появиться в тестах модулей,
 * работающих с ключами.
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

    /* Общий массив записей: тест проверяет журнал целиком,
       не собирая его по дочерним логгерам. */
    Object.defineProperty(child, 'records', { value: this.records })

    return child
  }

  #write(level: LogLevel, message: string, context: LogContext | undefined): void {
    this.records.push({ level, scope: this.#scope, message, context })
  }
}
