import { AppError } from './AppError'

/**
 * A call to an unimplemented operation.
 *
 * Used in stub services. It is essential that the stub throws, rather
 * than returning `undefined` or an empty array: a silent stub in a
 * wallet can look like a successful operation — for example a
 * "saved" key that does not exist.
 */
export class NotImplementedError extends AppError {
  readonly code = 'NOT_IMPLEMENTED'

  /**
   * @param member Full operation name in `ServiceName.methodName` form.
   */
  constructor(member: string) {
    super(`The operation "${member}" is not implemented at this stage of development.`)
  }
}
