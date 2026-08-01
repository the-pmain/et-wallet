import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки сетевого слоя и взаимодействия с RPC-узлами. */

/** Сеть с указанным chainId не зарегистрирована. */
export class NetworkNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkNotFound

  constructor(chainId: bigint) {
    super(`Сеть с chainId ${chainId.toString()} не найдена.`)
  }
}

/** Сеть с таким chainId уже добавлена. */
export class NetworkAlreadyExistsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkAlreadyExists

  constructor(chainId: bigint) {
    super(`Сеть с chainId ${chainId.toString()} уже добавлена.`)
  }
}

/**
 * Попытка изменить или удалить встроенную сеть.
 *
 * Встроенные сети неизменяемы сознательно. Возможность отредактировать
 * chainId или RPC основной сети через интерфейс добавления сети —
 * известный приём фишинга: пользователю предлагают «ускорить Ethereum»,
 * подменяя узел на подконтрольный.
 */
export class BuiltInNetworkImmutableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.BuiltInNetworkImmutable

  constructor(chainId: bigint) {
    super(`Встроенную сеть ${chainId.toString()} нельзя изменить или удалить.`)
  }
}

/**
 * RPC-адрес не является корректным URL.
 *
 * Отделено от {@link InsecureRpcUrlError}: разбор строки не удался вовсе,
 * поэтому говорить о протоколе бессмысленно.
 */
export class InvalidRpcUrlError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InvalidRpcUrl

  constructor(value: string) {
    super(`Значение "${value}" не является корректным URL.`)
  }
}

/**
 * RPC-адрес использует незащищённый протокол.
 *
 * Открытый HTTP означает, что посредник в канале способен подменить баланс,
 * nonce, цену газа и результат вызова контракта. Пользователь подпишет
 * транзакцию, отличную от той, которую видит на экране. Допустимы только
 * `https:` и `wss:`.
 */
export class InsecureRpcUrlError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.InsecureRpcUrl

  constructor(protocol: string) {
    super(`Протокол "${protocol}" недопустим для RPC. Разрешены только https и wss.`)
  }
}

/**
 * Узел сообщил chainId, отличный от ожидаемого.
 *
 * Наиболее опасная ошибка сетевого слоя. Подменённый или ошибочно
 * настроенный узел заставляет кошелёк подписать транзакцию для одной сети,
 * тогда как пользователю показана другая. Полученная подпись может быть
 * повторно проиграна в целевой сети.
 *
 * Обработка: немедленный разрыв соединения с узлом. Продолжение работы
 * при несовпадении недопустимо ни при каких условиях.
 */
export class ChainIdMismatchError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ChainIdMismatch

  /** Ожидаемый идентификатор сети из конфигурации. */
  readonly expected: bigint

  /** Идентификатор, фактически сообщённый узлом. */
  readonly actual: bigint

  constructor(expected: bigint, actual: bigint) {
    super(
      `Узел вернул chainId ${actual.toString()}, ожидался ${expected.toString()}. ` +
        'Соединение разорвано.',
    )
    this.expected = expected
    this.actual = actual
  }
}

/**
 * Добавляемая сеть носит имя встроенной, но обслуживает другую цепь.
 *
 * Основной приём подмены сети. Сайт предлагает добавить сеть с привычным
 * именем и собственным идентификатором; сверка chainId с узлом её
 * пропускает, потому что узел честно сообщает свой идентификатор.
 * В шапке кошелька появляется знакомое имя, и пользователь подписывает
 * перевод, считая его отправкой в основную сеть.
 *
 * Обработка: показать пользователю, за какую сеть выдаёт себя
 * добавляемая, и добавить только по явному согласию — параметром
 * `allowImpersonation`.
 */
export class NetworkImpersonationError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkImpersonation

  /** Имя встроенной сети, которое присвоила себе добавляемая. */
  readonly impersonatedName: string

  /** Идентификатор подлинной встроенной сети с таким именем. */
  readonly impersonatedChainId: bigint

  constructor(impersonatedName: string, impersonatedChainId: bigint, actualChainId: bigint) {
    super(
      `Сеть с именем «${impersonatedName}» уже существует и имеет chainId ` +
        `${impersonatedChainId.toString()}, а добавляемая — ${actualChainId.toString()}. ` +
        'Совпадение имени при другом идентификаторе — типичный приём подмены сети.',
    )
    this.impersonatedName = impersonatedName
    this.impersonatedChainId = impersonatedChainId
  }
}

/** Ни один RPC-узел сети не отвечает. */
export class ProviderUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ProviderUnavailable

  constructor(chainId: bigint, options?: ErrorOptions) {
    super(`Нет доступных RPC-узлов для сети ${chainId.toString()}.`, options)
  }
}

/**
 * Узел вернул ошибку JSON-RPC.
 *
 * Поле `rpcCode` сохраняется отдельно: коды JSON-RPC стандартизованы,
 * и обработка обязана опираться на них, а не на текст сообщения,
 * который у разных реализаций узлов различается.
 */
export class RpcError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.RpcError

  /** Числовой код ошибки JSON-RPC, возвращённый узлом. */
  readonly rpcCode: number

  /** Дополнительные данные узла. Структура не стандартизована. */
  readonly data: unknown

  constructor(rpcCode: number, message: string, data?: unknown) {
    super(`Ошибка RPC ${String(rpcCode)}: ${message}`)
    this.rpcCode = rpcCode
    this.data = data
  }
}
