import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки шифрования, источника случайности и постоянного хранилища. */

/**
 * Криптостойкая случайность недоступна либо неисправна.
 *
 * Фатальное состояние. Приложение обязано остановиться, а не переходить
 * на запасной генератор: кошелёк без криптостойкой случайности не может
 * безопасно создать ни один ключ, а ключи, выведенные из слабого источника,
 * вычисляются злоумышленником напрямую.
 */
export class RandomnessUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.RandomnessUnavailable

  constructor(detail: string) {
    super(`Источник случайности непригоден: ${detail}`)
  }
}

/**
 * Расшифровать данные не удалось.
 *
 * Причина не детализируется намеренно. AES-GCM не различает «неверный ключ»
 * и «повреждённые данные» — в обоих случаях не сходится тег аутентификации.
 * Попытка домыслить причину дала бы подбирающему пароль лишний сигнал.
 */
export class DecryptionFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.DecryptionFailed

  constructor(options?: ErrorOptions) {
    super('Не удалось расшифровать данные.', options)
  }
}

/** Структура зашифрованного хранилища нарушена. */
export class VaultCorruptedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.VaultCorrupted

  constructor(detail: string, options?: ErrorOptions) {
    super(`Хранилище повреждено: ${detail}`, options)
  }
}

/**
 * Версия формата хранилища новее поддерживаемой.
 *
 * Возникает при откате приложения на предыдущую версию. Обработка обязана
 * останавливать работу, а НЕ пытаться прочитать данные «как получится»:
 * попытка интерпретировать неизвестный формат способна привести к перезаписи
 * хранилища и безвозвратной потере ключей.
 */
export class UnsupportedVaultVersionError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UnsupportedVaultVersion

  constructor(found: number, supported: number) {
    super(
      `Версия хранилища ${String(found)} не поддерживается. Максимальная: ${String(supported)}.`,
    )
  }
}

/** Обращение к содержимому буфера, который уже был затёрт. */
export class SecretBufferWipedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.SecretBufferWiped

  constructor() {
    super('Буфер секрета уже затёрт и не может быть прочитан.')
  }
}

/** Хранилище недоступно: приватный режим браузера, отказ в квоте, отключённый IndexedDB. */
export class StorageUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageUnavailable

  constructor(detail: string, options?: ErrorOptions) {
    super(`Хранилище недоступно: ${detail}`, options)
  }
}

/** Запись в хранилище не выполнена. */
export class StorageWriteFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageWriteFailed

  constructor(key: string, options?: ErrorOptions) {
    super(`Не удалось записать данные по ключу "${key}".`, options)
  }
}

/** Чтение из хранилища не выполнено. */
export class StorageReadFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.StorageReadFailed

  constructor(key: string, options?: ErrorOptions) {
    super(`Не удалось прочитать данные по ключу "${key}".`, options)
  }
}

/** Миграция схемы хранилища завершилась ошибкой. */
export class MigrationFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.MigrationFailed

  constructor(version: number, options?: ErrorOptions) {
    super(`Миграция хранилища до версии ${String(version)} не выполнена.`, options)
  }
}
