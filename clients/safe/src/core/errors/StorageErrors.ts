import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * Cryptographically secure randomness is unavailable or broken.
 *
 * A fatal state. The app must stop, not fall back to a spare
 * generator: a wallet without CSPRNG cannot safely create any key,
 * and keys derived from a weak source are computed by an attacker
 * directly.
 */
export class RandomnessUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.RandomnessUnavailable

  constructor(detail: string) {
    super(`The randomness source is unusable: ${detail}`)
  }
}

/**
 * Data could not be decrypted.
 *
 * The reason is deliberately not detailed. AES-GCM does not distinguish
 * "wrong key" from "corrupted data" — in both cases the authentication
 * tag fails. Guessing a reason would give a password-guesser extra
 * signal.
 */
export class DecryptionFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.DecryptionFailed

  constructor(options?: ErrorOptions) {
    super('The data could not be decrypted.', options)
  }
}

export class VaultCorruptedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.VaultCorrupted

  constructor(detail: string, options?: ErrorOptions) {
    super(`The storage is corrupted: ${detail}`, options)
  }
}

/**
 * The vault format version is newer than this build supports.
 *
 * Arises when the app is rolled back. Handling must stop work, NOT try
 * to read the data "as best we can": interpreting an unknown format
 * can rewrite the vault and lose keys irreversibly.
 */
export class UnsupportedVaultVersionError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UnsupportedVaultVersion

  constructor(found: number, supported: number) {
    super(
      `Storage version ${String(found)} is not supported. The highest supported version is ${String(supported)}.`,
    )
  }
}

export class SecretBufferWipedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.SecretBufferWiped

  constructor() {
    super('The secret buffer has been wiped and can no longer be read.')
  }
}

export class StorageUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageUnavailable

  constructor(detail: string, options?: ErrorOptions) {
    super(`The storage is unavailable: ${detail}`, options)
  }
}

export class StorageWriteFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageWriteFailed

  constructor(key: string, options?: ErrorOptions) {
    super(`The data could not be written under the key "${key}".`, options)
  }
}

export class StorageReadFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageReadFailed

  constructor(key: string, options?: ErrorOptions) {
    super(`The data could not be read under the key "${key}".`, options)
  }
}

export class MigrationFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.MigrationFailed

  constructor(version: number, options?: ErrorOptions) {
    super(`Storage migration to version ${String(version)} was not performed.`, options)
  }
}
