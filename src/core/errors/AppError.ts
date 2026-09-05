/**
 * Base class of every application error.
 *
 * Why a separate hierarchy instead of `new Error(...)`:
 *
 * 1. The `code` field is a stable machine-readable identifier. Error
 *    handling and localisation are built on it. The class name is
 *    unfit: a bundler minifier will rename classes, and `error.name`
 *    becomes garbage.
 *
 * 2. Split messages. `message` is for the developer and logs; user
 *    copy is built from `code` in the UI. That keeps technical details
 *    (paths, values, data fragments) out of the wallet interface.
 *
 * 3. `cause` keeps the original error without mixing its text into
 *    the application one.
 */
export abstract class AppError extends Error {
  /**
   * Stable error code. The only identifier handling code may rely on.
   * Format: SCREAMING_SNAKE_CASE.
   */
  abstract readonly code: string

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options)

    /* new.target points at the class actually instantiated, not
       AppError. Useful when debugging a dev build; in production it
       cannot be relied on because of minification — that is what
       `code` is for. */
    this.name = new.target.name
  }
}

/**
 * Whether a value is an application error.
 *
 * Combined with `instanceof` this narrows the type in catch blocks,
 * where the variable is `unknown`.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}
