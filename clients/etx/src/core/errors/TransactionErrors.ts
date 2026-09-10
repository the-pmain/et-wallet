/**
 * Предмет не принадлежит отправителю.
 *
 * ПРОВЕРЯЕТСЯ ДО ПОДПИСИ. Контракт откатит такой вызов сам, но газ
 * при этом спишется, а причина отказа останется невнятной. Владелец
 * мог отдать предмет с другого устройства либо смотреть на устаревший
 * список — и то и другое надо назвать прямо.
 */
export class NftNotOwnedError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NftNotOwned

  constructor(reason: string) {
    super(`The item cannot be sent: ${reason}.`)
  }
}

/**
 * Токенов на балансе меньше, чем отправляется.
 *
 * ПРОВЕРЯЕТСЯ ОТДЕЛЬНО ОТ НАТИВНОГО БАЛАНСА. Средств на комиссию может
 * хватать, а токенов — нет; контракт в этом случае откатит вызов, газ
 * спишется, а перевода не будет. Отказ узла в оценке газа сообщает лишь
 * «вызов завершится откатом» и не называет причину.
 */
export class InsufficientTokenBalanceError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsufficientTokenBalance

  /** Требуемое количество в минимальных единицах токена. */
  readonly required: bigint

  /** Доступное количество в минимальных единицах токена. */
  readonly available: bigint

  constructor(required: bigint, available: bigint) {
    super('The token balance is lower than the amount being sent.')
    this.required = required
    this.available = available
  }
}

/**
 * Транзакцию нельзя заменить.
 *
 * Причина называется дословно и показывается пользователю: «ускорить
 * не удалось» без объяснения оставляет владельца наедине с зависшим
 * переводом, а причины требуют разных действий — подождать, обновить
 * приложение либо не делать ничего, потому что перевод уже прошёл.
 */
export class TransactionNotReplaceableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionNotReplaceable

  constructor(reason: string) {
    super(`The transaction cannot be replaced: ${reason}.`)
  }
}
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
    super('There are not enough funds for this operation.')
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

  /**
   * Данные отката, возвращённые контрактом.
   *
   * СОХРАНЯЮТСЯ СЫРЫМИ, потому что разобрать их можно не всегда.
   * Стандартную причину `Error(string)` библиотека раскрывает сама,
   * но собственные ошибки контрактов — это четырёхбайтовый признак,
   * смысл которого без описания контракта неизвестен. Показать
   * пользователю сам признак честнее, чем заменить его словами
   * «вызов отклонён»: по признаку можно найти причину, по общей
   * фразе — нельзя.
   *
   * `null` — узел данных не вернул.
   */
  readonly revertData: string | null

  /**
   * Причина отдельно от текста ошибки.
   *
   * Текст описывает неудачу оценки газа, а причина принадлежит вызову
   * и годится там, где об оценке речи нет: при проверке вызова до
   * подписи фраза «не удалось оценить газ» ввела бы в заблуждение.
   */
  readonly reason: string

  constructor(reason: string, options?: ErrorOptions & { readonly revertData?: string | null }) {
    super(`The gas limit could not be estimated: ${reason}`, options)

    this.reason = reason
    this.revertData = options?.revertData ?? null
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
    super(`Nonce ${String(provided)} has already been used. Expected ${String(expected)}.`)
    this.provided = provided
    this.expected = expected
  }
}

/** Транзакция не найдена ни в истории, ни в мемпуле. */
export class TransactionNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TransactionNotFound

  constructor(hash: string) {
    super(`Transaction was not found: ${hash}`)
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
    super('The offered gas price is too low to replace the transaction.')
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
    super(`The operation was rejected: ${operation}`)
  }
}

/** Токен не найден в списке отслеживаемых. */
export class TokenNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TokenNotFound

  constructor(address: string) {
    super(`Token was not found: ${address}`)
  }
}

/** По адресу нет контракта либо он не реализует заявленный стандарт. */
export class InvalidTokenContractError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidTokenContract

  constructor(address: string, reason: string) {
    super(`Contract ${address} is unusable: ${reason}`)
  }
}

/**
 * Контракт выдаёт себя за проверенный токен.
 *
 * Символ и имя токена задаёт автор контракта: это строка, которую
 * контракт возвращает по запросу, а не свойство сети. Назваться `USDC`
 * может любой, и владелец, увидев в списке привычный символ, отправит
 * на него средства либо выдаст разрешение.
 *
 * Обработка: показать, за какой токен выдаёт себя контракт, назвать
 * подлинный адрес и добавить только по явному согласию.
 */
export class TokenImpersonationError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.TokenImpersonation

  /** Подлинный адрес токена, за который выдаёт себя контракт. */
  readonly genuineAddress: string

  /** Символы вне латиницы и цифр. Пусто при совпадении по буквам. */
  readonly foreignCharacters: readonly string[]

  constructor(
    impersonatedSymbol: string,
    genuineAddress: string,
    actualAddress: string,
    foreignCharacters: readonly string[] = [],
  ) {
    super(
      (foreignCharacters.length === 0
        ? `The contract ${actualAddress} calls itself "${impersonatedSymbol}", `
        : `The contract ${actualAddress} calls itself "${impersonatedSymbol}" using letters ` +
          `from another alphabet (${foreignCharacters.join(' ')}), `) +
        `but the verified token with that name is ${genuineAddress}. ` +
        'Naming a contract after a well-known token is the usual way to make someone ' +
        'send funds to a worthless one.',
    )
    this.genuineAddress = genuineAddress
    this.foreignCharacters = foreignCharacters
  }
}

/** Стандарт токена не поддерживается текущей версией приложения. */
export class UnsupportedTokenStandardError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.UnsupportedTokenStandard

  constructor(standard: string) {
    super(`Token standard is not supported: ${standard}`)
  }
}
