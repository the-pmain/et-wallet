import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки общего назначения, не привязанные к конкретному домену. */

/**
 * Аргумент не удовлетворяет контракту метода.
 *
 * Отличие от ошибок предметной области: это дефект вызывающего кода либо
 * непрошедший валидацию пользовательский ввод, а не штатное состояние
 * системы. В журнале такие ошибки заслуживают отдельного внимания.
 */
export class InvalidArgumentError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidArgument

  /** Имя аргумента, не прошедшего проверку. */
  readonly argument: string

  constructor(argument: string, reason: string) {
    super(`Некорректное значение аргумента "${argument}": ${reason}`)
    this.argument = argument
  }
}

/**
 * Обращение к сервису до вызова его `init()`.
 *
 * Явная ошибка лучше молчаливого возврата пустого результата: сервис,
 * который «работает» с незагруженным состоянием, даёт кошельку показать
 * пустой список сетей вместо сообщения о проблеме инициализации.
 */
export class NotInitializedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NotInitialized

  constructor(serviceName: string) {
    super(`Сервис "${serviceName}" не инициализирован. Требуется вызов init().`)
  }
}
