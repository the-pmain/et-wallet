import { AppError, ERROR_CODE } from '@/core/errors'
import type { ErrorCode } from '@/core/errors'

/**
 * Отказ пользователя на экране устройства.
 *
 * Вынесен в постоянную, потому что сравнивается: отказ человека —
 * не сбой, и показывать его как ошибку неправильно.
 */
export const USER_REJECTED_ON_DEVICE = 'the operation was rejected on the device'

/**
 * Устройство не выполнило операцию.
 *
 * ПРИЧИНА ХРАНИТСЯ СЛОВАМИ, А НЕ КОДОМ. У отказов устройства разные
 * последствия: заблокированный экран требует ввести PIN, закрытое
 * приложение — открыть его, отказ человека — вообще ничего.
 * Свести их к «устройство недоступно» значит заставить искать причину
 * наугад.
 */
export class HardwareDeviceError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.KeyringCannotSign

  /**
   * Операция отклонена человеком, а не устройством.
   *
   * Различие видно в интерфейсе: отказ показывается спокойно,
   * а не как поломка.
   */
  readonly isUserRejection: boolean

  constructor(reason: string, options: { readonly isUserRejection?: boolean } = {}) {
    super(reason)

    this.isUserRejection = options.isUserRejection ?? false
  }
}
