import { AppError, ERROR_CODE } from '@/core/errors'
import type { ErrorCode } from '@/core/errors'

/**
 * User rejection on the device screen.
 *
 * Lifted into a constant because it is compared: a person's refusal
 * is not a fault, and showing it as an error is wrong.
 */
export const USER_REJECTED_ON_DEVICE = 'the operation was rejected on the device'

/**
 * The device did not perform the operation.
 *
 * THE REASON IS STORED IN WORDS, NOT A CODE. Device refusals have
 * different consequences: a locked screen needs a PIN, a closed
 * application needs to be opened, a person's refusal needs nothing.
 * Collapsing them to "device unavailable" forces guessing the cause.
 */
export class HardwareDeviceError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringCannotSign

  /**
   * The operation was declined by a person, not by the device.
   *
   * The distinction is visible in the UI: a refusal is shown calmly,
   * not as a breakage.
   */
  readonly isUserRejection: boolean

  constructor(reason: string, options: { readonly isUserRejection?: boolean } = {}) {
    super(reason)

    this.isUserRejection = options.isUserRejection ?? false
  }
}
