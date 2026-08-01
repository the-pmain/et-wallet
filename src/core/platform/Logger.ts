/** Уровни журналирования в порядке возрастания важности. */
export const LOG_LEVEL = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL]

/** Дополнительный контекст записи журнала. */
export type LogContext = Readonly<Record<string, unknown>>

/**
 * Журналирование.
 *
 * ТРЕБОВАНИЕ БЕЗОПАСНОСТИ, обязательное для любой реализации: логгер обязан
 * редактировать чувствительные значения перед выводом. Не «желательно», а
 * обязан, потому что журнал кошелька попадает в отчёты об ошибках, в консоль
 * браузера и в буфер обмена пользователя.
 *
 * Безусловной редакции подлежат:
 * - seed-фразы и приватные ключи в любом виде;
 * - пароли и производные от них ключи;
 * - содержимое `ISecretBuffer`;
 * - подписи до их публикации в сети.
 *
 * Адреса и суммы редактируются частично: адрес усекается до первых и
 * последних символов. Полный адрес в журнале — это идентификатор личности
 * пользователя, связывающий его с историей операций.
 *
 * Уровень `Debug` в production-сборке обязан быть выключен.
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void

  /**
   * Создаёт дочерний логгер с постоянным префиксом.
   * Позволяет не дублировать имя модуля в каждом вызове.
   */
  child(scope: string): ILogger
}
