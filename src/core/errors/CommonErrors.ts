import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * An argument does not satisfy the method contract.
 *
 * Distinct from domain errors: this is a caller defect or failed
 * user-input validation, not a normal system state. In the log these
 * errors deserve separate attention.
 */
export class InvalidArgumentError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidArgument

  readonly argument: string

  constructor(argument: string, reason: string) {
    super(`Invalid value for the argument "${argument}": ${reason}`)
    this.argument = argument
  }
}

/**
 * A service was used before `init()` was called.
 *
 * An explicit error is better than silently returning empty: a service
 * that "works" with unloaded state would let the wallet show an empty
 * network list instead of an initialisation problem.
 */
export class NotInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NotInitialized

  constructor(serviceName: string) {
    super(`The service "${serviceName}" is not initialised. A call to init() is required.`)
  }
}
