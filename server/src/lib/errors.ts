/**
 * A refusal that may be shown to the client.
 *
 * WHY A SEPARATE CLASS, NOT A PLAIN `Error`. Only what we chose to
 * say must leave the process. An arbitrary error message contains
 * file paths, internal module names, sometimes data fragments; all
 * of that helps an attacker and does not help the user.
 */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** The requested resource does not exist. */
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'not_found', message)
    this.name = 'NotFoundError'
  }
}

/** The request is malformed. */
export class BadRequestError extends ApiError {
  constructor(code: string, message: string) {
    super(400, code, message)
    this.name = 'BadRequestError'
  }
}

/**
 * The presented value did not match.
 *
 * One message for every login refusal: telling "no record" from
 * "wrong value" is a hint to whoever is guessing `the_p`.
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, 'unauthorized', message)
    this.name = 'UnauthorizedError'
  }
}

/** Credentials accepted, but this role has no such operation. */
export class ForbiddenError extends ApiError {
  constructor(message: string) {
    super(403, 'forbidden', message)
    this.name = 'ForbiddenError'
  }
}

/** The record was changed by another device. */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'revision_conflict', message)
    this.name = 'ConflictError'
  }
}

/**
 * The service cannot fulfill the request: no database connection,
 * or the database rejected the write.
 */
export class ServiceUnavailableError extends ApiError {
  constructor(message: string) {
    super(503, 'database_unavailable', message)
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * Mail sending is not configured: no account id or Cloudflare token.
 */
export class EmailUnavailableError extends ApiError {
  constructor(message: string) {
    super(503, 'email_unavailable', message)
    this.name = 'EmailUnavailableError'
  }
}

/**
 * Cloudflare accepted the request, but the mail was not sent.
 */
export class EmailSendError extends ApiError {
  constructor(statusCode: number, message: string) {
    super(statusCode, 'email_send_failed', message)
    this.name = 'EmailSendError'
  }
}

/**
 * The catalog failed validation on load.
 *
 * This is a deploy error, not a runtime one: a service with a corrupt
 * catalog must not start. Starting with a mistyped contract address
 * would serve that address to every user.
 */
export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(`Catalog failed validation: ${message}`)
    this.name = 'CatalogValidationError'
  }
}
