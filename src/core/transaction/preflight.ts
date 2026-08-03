import { GasEstimationFailedError } from '@/core/errors'
import type { IProvider } from '@/core/provider'
import {
  SELECTOR_LENGTH,
  WORD_LENGTH,
  decodeUint,
  functionSelector,
  strip,
} from '@/core/abi/encoding'
import type { Address, HexString, Wei } from '@/core/types'

/**
 * Признак стандартной причины отката: `Error(string)`.
 *
 * Задан в Solidity и возвращается любым `require` со строкой.
 */
const ERROR_STRING_SELECTOR = functionSelector('Error(string)')

/** Признак внутренней ошибки времени выполнения: `Panic(uint256)`. */
const PANIC_SELECTOR = functionSelector('Panic(uint256)')

/**
 * Значения кода паники.
 *
 * Взяты из документации Solidity. Переводятся в слова, потому что
 * «паника 0x11» не говорит владельцу средств ничего, а «переполнение
 * при вычислении» указывает на сумму, которую он ввёл.
 */
const PANIC_REASONS: ReadonlyMap<bigint, string> = new Map([
  [0x01n, 'an assertion inside the contract failed'],
  [0x11n, 'an arithmetic operation overflowed'],
  [0x12n, 'a division by zero'],
  [0x21n, 'a value outside the allowed set was passed'],
  [0x22n, 'a malformed storage array'],
  [0x31n, 'an attempt to remove an element from an empty array'],
  [0x32n, 'an index outside the array bounds'],
  [0x41n, 'the contract ran out of memory'],
  [0x51n, 'a call to an uninitialised internal function'],
])

/**
 * Вызовы, чей отказ выражается возвращённым значением, а не откатом.
 *
 * ЭТО НЕ ТЕОРЕТИЧЕСКИЙ СЛУЧАЙ. Стандарт ERC-20 предписывает `transfer`
 * возвращать признак успеха, и часть контрактов при нехватке средств
 * либо запрете возвращает `false` вместо отката. Транзакция при этом
 * попадает в блок и выглядит выполненной: газ списан, состояние
 * не изменилось, а кошелёк рапортует об отправке.
 */
const BOOLEAN_RESULT_SELECTORS: ReadonlySet<string> = new Set([
  functionSelector('transfer(address,uint256)'),
  functionSelector('transferFrom(address,address,uint256)'),
  functionSelector('approve(address,uint256)'),
])

/** Чем закончился предварительный прогон. */
export const PREFLIGHT_OUTCOME = {
  /** Узел выполнил вызов на текущем состоянии без отката. */
  Passed: 'passed',

  /** Вызов завершился откатом: отправлять его — сжечь газ впустую. */
  Reverted: 'reverted',

  /**
   * Контракт отказал возвращённым значением, не откатывая вызов.
   *
   * Опаснее отката: транзакция попадёт в блок и будет выглядеть
   * выполненной.
   */
  RejectedByContract: 'rejected-by-contract',

  /**
   * Проверить не удалось.
   *
   * ОТЛИЧАТЬ ОТ УСПЕХА ОБЯЗАТЕЛЬНО. Недоступный узел не подтверждает
   * ничего, и выдать его молчание за «проверено» значило бы поставить
   * подпись под непроверенным вызовом.
   */
  Unavailable: 'unavailable',
} as const

export type PreflightOutcome = (typeof PREFLIGHT_OUTCOME)[keyof typeof PREFLIGHT_OUTCOME]

/** Итог предварительного прогона. */
export interface IPreflightResult {
  readonly outcome: PreflightOutcome

  /**
   * Причина отказа словами. `null` — причина неизвестна.
   *
   * Приходит от контракта и показывается дословно.
   */
  readonly reason: string | null

  /**
   * Сырые данные отката.
   *
   * Нужны, когда причину разобрать нельзя: собственная ошибка
   * контракта — четырёхбайтовый признак, по которому можно найти
   * описание, тогда как фраза «вызов отклонён» не даёт ничего.
   */
  readonly revertData: string | null
}

/** Что проверяется. */
export interface IPreflightRequest {
  readonly from: Address

  /** `null` — развёртывание контракта. */
  readonly to: Address | null

  readonly data: HexString
  readonly value: Wei
}

/**
 * Прогоняет транзакцию на узле до подписи.
 *
 * ЧТО ЭТО ЕСТЬ. Вызов `eth_call` с теми же полями, что уйдут в сеть:
 * узел выполняет его на текущем состоянии цепи и ничего не публикует.
 * Отказ здесь означает, что и настоящая транзакция откатится.
 *
 * ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Это не предсказание изменений балансов: чтобы
 * получить их, нужна трассировка вызова либо подмена состояния,
 * а публичные узлы того и другого не предоставляют. Называть такую
 * проверку «симуляцией» значило бы обещать больше, чем сделано.
 *
 * СОСТОЯНИЕ МЕНЯЕТСЯ МЕЖДУ ПРОВЕРКОЙ И ВКЛЮЧЕНИЕМ В БЛОК. Проверка
 * говорит о состоянии на момент вызова, а не о будущем: разрешение
 * может быть отозвано, а средства — потрачены другой транзакцией.
 * Пройденная проверка не обещает выполнения, и интерфейс обязан
 * говорить об этом так же прямо.
 *
 * РАЗВЁРТЫВАНИЕ КОНТРАКТА НЕ ПРОВЕРЯЕТСЯ: `eth_call` без получателя
 * возвращает байт-код будущего контракта, а не признак успеха, и
 * судить по нему не о чем.
 */
export async function preflightCall(
  provider: IProvider,
  request: IPreflightRequest,
): Promise<IPreflightResult> {
  if (request.to === null) {
    return { outcome: PREFLIGHT_OUTCOME.Unavailable, reason: null, revertData: null }
  }

  const to = request.to

  try {
    const result = await provider.call({
      to,
      from: request.from,
      data: request.data,
      value: request.value,
    })

    return interpretResult(request.data, result)
  } catch (error) {
    return interpretFailure(error)
  }
}

/**
 * Толкует успешный ответ узла.
 *
 * Отсутствие отката ещё не означает согласия контракта: у вызовов
 * с булевым результатом отказ выражается значением `false`.
 */
function interpretResult(data: HexString, result: HexString): IPreflightResult {
  const passed: IPreflightResult = {
    outcome: PREFLIGHT_OUTCOME.Passed,
    reason: null,
    revertData: null,
  }

  if (!BOOLEAN_RESULT_SELECTORS.has(strip(data).slice(0, SELECTOR_LENGTH))) {
    return passed
  }

  const body = strip(result)

  /* Пустой ответ на вызов с объявленным булевым результатом —
     обычное поведение контрактов, написанных до уточнения стандарта.
     Отсутствие `false` здесь толкуется в пользу успеха: считать
     такой вызов отказом значило бы запретить работу с ними. */
  if (body.length < WORD_LENGTH) {
    return passed
  }

  if (decodeUint(result) !== 0n) {
    return passed
  }

  return {
    outcome: PREFLIGHT_OUTCOME.RejectedByContract,
    reason:
      'the contract returned "false" instead of reverting: the transaction would be included in a block and change nothing',
    revertData: null,
  }
}

/** Толкует отказ узла. */
function interpretFailure(error: unknown): IPreflightResult {
  if (!(error instanceof GasEstimationFailedError)) {
    /* Узел недоступен либо ответил не по делу. Это не отказ вызова,
       и выдавать его за откат нельзя: пользователь исправлял бы
       несуществующую ошибку в своей транзакции. */
    return { outcome: PREFLIGHT_OUTCOME.Unavailable, reason: null, revertData: null }
  }

  const revertData = error.revertData

  return {
    outcome: PREFLIGHT_OUTCOME.Reverted,
    reason: decodeRevertReason(revertData) ?? error.reason,
    revertData,
  }
}

/**
 * Разбирает данные отката.
 *
 * Три случая, и все три различимы: стандартная причина строкой,
 * внутренняя ошибка времени выполнения кодом и собственная ошибка
 * контракта, о которой без его описания сказать нечего.
 */
export function decodeRevertReason(revertData: string | null): string | null {
  if (revertData === null) {
    return null
  }

  const body = strip(revertData)

  if (body.length < SELECTOR_LENGTH) {
    return null
  }

  const selector = body.slice(0, SELECTOR_LENGTH)
  const payload = body.slice(SELECTOR_LENGTH)

  if (selector === ERROR_STRING_SELECTOR) {
    return decodeErrorString(payload)
  }

  if (selector === PANIC_SELECTOR) {
    if (payload.length < WORD_LENGTH) {
      return null
    }

    const code = decodeUint(`0x${payload}` as HexString)

    return PANIC_REASONS.get(code) ?? `an internal contract error, code ${code.toString()}`
  }

  /* Собственная ошибка контракта. Расшифровать её без описания
     контракта нельзя, и придумывать толкование недопустимо: признак
     показывается как есть, по нему причину можно найти. */
  return `the contract rejected the call with its own error 0x${selector}`
}

/**
 * Читает строку причины из `Error(string)`.
 *
 * Данные недоверенные: узел мог вернуть обрезанный либо испорченный
 * ответ, и разбор обязан кончаться отсутствием причины, а не
 * исключением поверх уже случившегося отказа.
 */
function decodeErrorString(payload: string): string | null {
  const body = payload

  if (body.length < WORD_LENGTH * 2) {
    return null
  }

  const length = Number(BigInt(`0x${body.slice(WORD_LENGTH, WORD_LENGTH * 2)}`))
  const text = body.slice(WORD_LENGTH * 2, WORD_LENGTH * 2 + length * 2)

  if (length === 0 || text.length < length * 2) {
    return null
  }

  const bytes = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
  }

  const decoded = new TextDecoder().decode(bytes)

  /* Управляющие символы в причине — признак либо испорченных данных,
     либо попытки подделать вид сообщения кошелька. Такая строка
     не показывается. */
  return /[\p{Cc}]/u.test(decoded) ? null : decoded
}
