/** Log levels in ascending importance. */
export const LOG_LEVEL = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL]

export type LogContext = Readonly<Record<string, unknown>>

/**
 * Logging.
 *
 * A SECURITY REQUIREMENT, binding on every implementation: the
 * logger must redact sensitive values before output. Not "should",
 * but must, because a wallet log ends up in error reports, the
 * browser console, and the user's clipboard.
 *
 * Unconditionally redacted:
 * - seed phrases and private keys in any form;
 * - passwords and keys derived from them;
 * - contents of `ISecretBuffer`;
 * - signatures before they are published on the network.
 *
 * Addresses and amounts are redacted in part: an address is
 * truncated to the first and last characters. A full address in the
 * log is a personal identifier that ties the user to their history.
 *
 * The `Debug` level must be off in a production build.
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void

  /**
   * Creates a child logger with a fixed prefix.
   * Avoids repeating the module name on every call.
   */
  child(scope: string): ILogger
}
