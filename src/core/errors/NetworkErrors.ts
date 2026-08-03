import { AppError } from './AppError'
import { ERROR_CODE, type ErrorCode } from './ErrorCode'

/** Ошибки сетевого слоя и взаимодействия с RPC-узлами. */

/** Сеть с указанным chainId не зарегистрирована. */
export class NetworkNotFoundError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkNotFound

  constructor(chainId: bigint) {
    super(`Network with chainId ${chainId.toString()} was not found.`)
  }
}

/** Сеть с таким chainId уже добавлена. */
export class NetworkAlreadyExistsError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.NetworkAlreadyExists

  constructor(chainId: bigint) {
    super(`Network with chainId ${chainId.toString()} has already been added.`)
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
    super(`Built-in network ${chainId.toString()} cannot be changed or removed.`)
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
    super(`The value "${value}" is not a valid URL.`)
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
    super(`The protocol "${protocol}" is not allowed for RPC. Only https and wss are permitted.`)
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
      `The node returned chainId ${actual.toString()}, expected ${expected.toString()}. ` +
        'The connection was lost.',
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

  /**
   * Имя записано буквами других алфавитов.
   *
   * ОТЛИЧИЕ, КОТОРОЕ ОБЯЗАНО ДОЙТИ ДО ЧЕЛОВЕКА. При совпадении
   * по буквам он видит два одинаковых названия и понимает сообщение
   * сразу. При подмене похожими символами он видит два ВИЗУАЛЬНО
   * ОДИНАКОВЫХ названия и сообщение «имя занято» — без объяснения оно
   * выглядит ошибкой кошелька, то есть поводом нажать «добавить
   * всё равно».
   */
  readonly foreignCharacters: readonly string[]

  constructor(
    impersonatedName: string,
    impersonatedChainId: bigint,
    actualChainId: bigint,
    foreignCharacters: readonly string[] = [],
  ) {
    super(
      foreignCharacters.length === 0
        ? `A network named "${impersonatedName}" already exists and has chainId ` +
            `${impersonatedChainId.toString()}, while the one being added has ${actualChainId.toString()}. ` +
            'A matching name with a different identifier is a common network spoofing trick.'
        : `The name is written with letters from another alphabet (${foreignCharacters.join(' ')}) ` +
            `so that it looks exactly like "${impersonatedName}", which has chainId ` +
            `${impersonatedChainId.toString()} — the one being added has ${actualChainId.toString()}. ` +
            'The two names are indistinguishable on screen, and that is the whole point of the trick.',
    )
    this.impersonatedName = impersonatedName
    this.impersonatedChainId = impersonatedChainId
    this.foreignCharacters = foreignCharacters
  }
}

/** Ни один RPC-узел сети не отвечает. */
export class ProviderUnavailableError extends AppError {
  readonly code: ErrorCode = ERROR_CODE.ProviderUnavailable

  constructor(chainId: bigint, options?: ErrorOptions) {
    super(`No RPC endpoints are available for network ${chainId.toString()}.`, options)
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
    super(`RPC error ${String(rpcCode)}: ${message}`)
    this.rpcCode = rpcCode
    this.data = data
  }
}
