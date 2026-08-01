import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки подготовки, подписи и отправки транзакций, а также работы с токенами. */

/**
 * Недостаточно средств.
 *
 * Величины передаются как `bigint` и не форматируются: перевод в читаемый
 * вид зависит от `decimals` валюты и настроек локали, то есть относится
 * к слою представления.
 */
export class InsufficientFundsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsufficientFunds

  /** Требуемая сумма в минимальных единицах. */
  readonly required: bigint

  /** Доступная сумма в минимальных единицах. */
  readonly available: bigint

  constructor(required: bigint, available: bigint) {
    super('Недостаточно средств для проведения операции.')
    this.required = required
    this.available = available
  }
}

/**
 * Оценить лимит газа не удалось.
 *
 * Практически всегда означает, что вызов контракта завершится откатом.
 * Отправлять транзакцию с произвольно назначенным лимитом в такой ситуации
 * нельзя: газ будет списан, а операция не выполнится.
 */
export class GasEstimationFailedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.GasEstimationFailed

  constructor(reason: string, options?: ErrorOptions) {
    super(`Не удалось оценить лимит газа: ${reason}`, options)
  }
}

/** Указанный nonce уже использован. */
export class NonceTooLowError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NonceTooLow

  /** Nonce, переданный в транзакции. */
  readonly provided: number

  /** Nonce, ожидаемый сетью. */
  readonly expected: number

  constructor(provided: number, expected: number) {
    super(`Nonce ${String(provided)} уже использован. Ожидается ${String(expected)}.`)
    this.provided = provided
    this.expected = expected
  }
}

/** Транзакция не найдена ни в истории, ни в мемпуле. */
export class TransactionNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionNotFound

  constructor(hash: string) {
    super(`Транзакция не найдена: ${hash}`)
  }
}

/**
 * Цена газа ниже минимально приемлемой для узла.
 *
 * Возникает при ускорении и отмене транзакций: замещающая транзакция
 * обязана предлагать цену выше исходной, иначе узел её отвергнет.
 */
export class TransactionUnderpricedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionUnderpriced

  constructor() {
    super('Предложенная цена газа слишком низкая для замещения транзакции.')
  }
}

/**
 * Пользователь отклонил операцию.
 *
 * Соответствует коду 4001 стандарта EIP-1193. Это НЕ сбой: dApp обязано
 * получить именно этот код, чтобы отличить отказ пользователя от
 * технической ошибки и не показывать ему сообщение об ошибке.
 */
export class UserRejectedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UserRejected

  /** Код отказа по EIP-1193. */
  static readonly EIP1193_CODE = 4001

  constructor(operation: string) {
    super(`Пользователь отклонил операцию: ${operation}`)
  }
}

/** Токен не найден в списке отслеживаемых. */
export class TokenNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TokenNotFound

  constructor(address: string) {
    super(`Токен не найден: ${address}`)
  }
}

/** По адресу нет контракта либо он не реализует заявленный стандарт. */
export class InvalidTokenContractError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidTokenContract

  constructor(address: string, reason: string) {
    super(`Контракт ${address} непригоден: ${reason}`)
  }
}

/** Стандарт токена не поддерживается текущей версией приложения. */
export class UnsupportedTokenStandardError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UnsupportedTokenStandard

  constructor(standard: string) {
    super(`Стандарт токена не поддерживается: ${standard}`)
  }
}
