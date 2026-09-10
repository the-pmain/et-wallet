import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/**
 * The derivation path does not match the BIP-32 format.
 *
 * The message includes the path: it is not a secret. The path describes
 * the key's position in the tree and gives no information about the
 * key itself.
 */
export class InvalidDerivationPathError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidDerivationPath

  constructor(path: string, reason: string) {
    super(`Invalid derivation path "${path}": ${reason}`)
  }
}

/**
 * An extended key does not parse.
 *
 * The message does NOT contain the key: an xprv is a secret that opens
 * the whole subtree. Even a fragment of it in a log is forbidden.
 */
export class InvalidExtendedKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidExtendedKey

  constructor(reason: string, options?: ErrorOptions) {
    super(`Extended key is invalid: ${reason}`, options)
  }
}

export class InvalidAddressError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidAddress

  constructor(value: string) {
    super(`The value "${value}" is not an EVM address.`)
  }
}

/**
 * The EIP-55 address checksum does not match.
 *
 * A separate error, not "invalid address", because it means something
 * else: the character set is correct, but the letter case does not
 * match. Almost always a typo on manual entry or damage on copy.
 *
 * Silently fixing the case of such an address is FORBIDDEN: EIP-55
 * would then stop doing its only job — catching typos before funds
 * are sent to a nonexistent address.
 */
export class AddressChecksumMismatchError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.AddressChecksumMismatch

  constructor(value: string) {
    super(
      `The checksum of the address "${value}" does not match. ` +
        'Check the address: it may contain a typo.',
    )
  }
}

export class InvalidPublicKeyError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidPublicKey

  constructor(reason: string, options?: ErrorOptions) {
    super(`Public key is invalid: ${reason}`, options)
  }
}
