import { toAddress } from '@/core/address'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  hexToBigInt,
  splitDataWords,
  topicToAddress,
} from '@/core/history'
import type { ILogEntry, IProvider } from '@/core/provider'
import type { Address, HexString, Wei } from '@/core/types'

import { decodeRevertReason } from './preflight'

/**
 * Псевдоадрес нативной валюты (ERC-7528).
 *
 * Перевод эфира событий не порождает, поэтому при `traceTransfers`
 * узел дописывает синтетический журнал с этим адресом и обычным
 * событием `Transfer`. Значение измерено на живом узле, а не взято
 * из описания: соглашение молодое, и реализации могли разойтись.
 */
const NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/** Код JSON-RPC «метода не существует». */
const JSON_RPC_METHOD_NOT_FOUND = -32601

/** Число тем у события ERC-721: признак события плюс три параметра. */
const ERC721_TOPIC_COUNT = 4

/** Чем закончилась симуляция. */
export const SIMULATION_OUTCOME = {
  /** Узел выполнил транзакцию на текущем состоянии и вернул её следствия. */
  Succeeded: 'succeeded',

  /** Транзакция откатится: отправлять её — сжечь газ впустую. */
  Reverted: 'reverted',

  /**
   * Узел не умеет `eth_simulateV1`.
   *
   * ОТДЕЛЬНО ОТ «НЕ УДАЛОСЬ». Метода нет — это свойство узла, которое
   * не изменится от повтора, и владельцу стоит знать, что дело в узле,
   * а не в его транзакции.
   */
  Unsupported: 'unsupported',

  /**
   * Узел не ответил либо отказал.
   *
   * ОТЛИЧАТЬ ОТ УСПЕХА ОБЯЗАТЕЛЬНО. Молчание узла не подтверждает
   * ничего; выдать его за «изменений нет» значило бы показать пустой
   * список там, где список неизвестен.
   */
  Unavailable: 'unavailable',
} as const

export type SimulationOutcome = (typeof SIMULATION_OUTCOME)[keyof typeof SIMULATION_OUTCOME]

/** Что за предмет перемещается. */
export const MOVEMENT_KIND = {
  Native: 'native',
  Erc20: 'erc20',
  Erc721: 'erc721',
  Erc1155: 'erc1155',
} as const

export type MovementKind = (typeof MOVEMENT_KIND)[keyof typeof MOVEMENT_KIND]

/** Одно перемещение средств, которое произойдёт при отправке. */
export interface IAssetMovement {
  readonly kind: MovementKind

  /** Адрес контракта. `null` — нативная валюта сети. */
  readonly contract: Address | null

  readonly from: Address
  readonly to: Address

  /**
   * Количество в наименьших единицах.
   *
   * `null` означает «известно, что перемещение есть, а сколько —
   * разобрать не удалось». Ноль на этом месте был бы утверждением
   * о сумме, которого симуляция не делала.
   */
  readonly amount: bigint | null

  /** Номер предмета для ERC-721 и ERC-1155. */
  readonly tokenId: bigint | null
}

/** Итог симуляции. */
export interface ISimulationResult {
  readonly outcome: SimulationOutcome

  /** Израсходованный газ. `null` — узел не сообщил. */
  readonly gasUsed: bigint | null

  /**
   * Перемещения средств в порядке их наступления.
   *
   * Пустой список ЗНАЧИМ только при исходе `succeeded`: он означает,
   * что транзакция не двигает средства вовсе. При прочих исходах
   * список пуст потому, что сведений нет.
   */
  readonly movements: readonly IAssetMovement[]

  /** Причина отката словами. `null` — неизвестна. */
  readonly reason: string | null
}

/** Что симулируется. */
export interface ISimulationRequest {
  readonly from: Address

  /** `null` — развёртывание контракта. */
  readonly to: Address | null

  readonly data: HexString
  readonly value: Wei
}

/** Итог, когда симуляция не проводилась. */
export const UNCHECKED_SIMULATION: ISimulationResult = {
  outcome: SIMULATION_OUTCOME.Unavailable,
  gasUsed: null,
  movements: [],
  reason: null,
}

/**
 * Показывает, что транзакция сделает, ещё до подписи.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ПРОГОНА `preflightCall`. Прогон отвечает на
 * вопрос «пройдёт ли», симуляция — на вопрос «что произойдёт». Первое
 * защищает от сожжённого газа, второе от подписи под тем, чего человек
 * не имел в виду: экран показывает получателя и сумму, взятые из полей
 * формы, а перемещения — то, что насчитал узел, выполнив вызов.
 * Расхождение между ними и есть признак подмены.
 *
 * ПОЧЕМУ ЭТО ПУТЬ ПО УМОЛЧАНИЮ. `eth_simulateV1` — обычный метод узла,
 * с которым кошелёк уже разговаривает: ни ключа, ни учётной записи,
 * ни ещё одного оператора, узнающего намерение владельца.
 *
 * Прежде здесь стояло, что сторонний сервис не нужен вовсе. Это
 * оказалось неверно в одной части: разбор журналов не видит того,
 * чего в журналах нет, а публичные узлы метод либо не знают, либо
 * отвечают отказом по частоте — измерено. Поэтому сторонний источник
 * добавлен (`core/simulation`), но именно как ДОБАВЛЕНИЕ: он
 * спрашивается первым только при явном согласии владельца, а узел
 * остаётся основанием и опрашивается всегда, когда источник промолчал.
 *
 * ПОДДЕРЖКА У УЗЛОВ РАЗНАЯ, и это не исключение, а обычное положение
 * дел: измерено, что часть публичных узлов метод не знает, а часть
 * отказывает по частоте обращений. Оба случая различаются в исходе
 * и не выдаются за «изменений нет».
 *
 * СИМУЛЯЦИЯ НЕ ГАРАНТИЯ. Она выполнена на состоянии цепи в этот миг;
 * к моменту включения в блок состояние может стать другим. Интерфейс
 * обязан говорить «произойдёт по нынешнему состоянию», а не
 * «произойдёт».
 */
export async function simulateTransaction(
  provider: IProvider,
  request: ISimulationRequest,
): Promise<ISimulationResult> {
  let response: unknown

  try {
    response = await provider.request({
      method: 'eth_simulateV1',
      params: [
        {
          blockStateCalls: [
            {
              calls: [
                {
                  from: request.from,
                  ...(request.to === null ? {} : { to: request.to }),
                  data: request.data,
                  value: `0x${request.value.toString(16)}`,
                },
              ],
            },
          ],
          /* Без этого перевод нативной валюты не виден вовсе: событий
             он не порождает, и список перемещений оказался бы пустым
             у самой обычной отправки. */
          traceTransfers: true,
          /* Проверка баланса и nonce отключена намеренно. Их проверяют
             оценка комиссии и прогон вызова, а здесь отказ по нехватке
             средств скрыл бы то единственное, ради чего симуляция
             и нужна, — перечень перемещений. */
          validation: false,
        },
        'latest',
      ],
    })
  } catch (error) {
    return {
      ...UNCHECKED_SIMULATION,
      outcome: isMethodNotFound(error)
        ? SIMULATION_OUTCOME.Unsupported
        : SIMULATION_OUTCOME.Unavailable,
    }
  }

  return readResponse(response)
}

/**
 * Разбирает ответ узла.
 *
 * Ответ недоверенный: узел может вернуть что угодно, поэтому каждое
 * поле проверяется отдельно, а неожиданная форма даёт «проверить
 * не удалось», а не исключение посреди подготовки транзакции.
 */
function readResponse(response: unknown): ISimulationResult {
  if (!Array.isArray(response)) {
    return UNCHECKED_SIMULATION
  }

  const block = response[0] as { calls?: unknown } | undefined
  const calls = block?.calls

  if (!Array.isArray(calls)) {
    return UNCHECKED_SIMULATION
  }

  const call = calls[0] as
    { status?: unknown; gasUsed?: unknown; returnData?: unknown; logs?: unknown } | undefined

  if (call === undefined) {
    return UNCHECKED_SIMULATION
  }

  const gasUsed = typeof call.gasUsed === 'string' ? hexToBigInt(call.gasUsed) : null

  /* Признак успеха у `eth_simulateV1` тот же, что у квитанции:
     `0x1` — выполнено, `0x0` — откат. */
  if (call.status !== '0x1') {
    return {
      outcome: SIMULATION_OUTCOME.Reverted,
      gasUsed,
      movements: [],
      reason: typeof call.returnData === 'string' ? decodeRevertReason(call.returnData) : null,
    }
  }

  return {
    outcome: SIMULATION_OUTCOME.Succeeded,
    gasUsed,
    movements: Array.isArray(call.logs) ? readMovements(call.logs as readonly unknown[]) : [],
    reason: null,
  }
}

/** Отбирает из журналов те, что означают перемещение средств. */
function readMovements(logs: readonly unknown[]): readonly IAssetMovement[] {
  const movements: IAssetMovement[] = []

  for (const entry of logs) {
    const log = entry as Partial<ILogEntry>

    if (typeof log.address !== 'string' || !Array.isArray(log.topics)) {
      continue
    }

    const movement = readMovement(
      log.address,
      log.topics as readonly HexString[],
      /* Пустые данные — законный случай: у ERC-721 всё лежит в темах.
         Приведение здесь безопасно: `splitDataWords` разбирает строку
         посимвольно и на пустой возвращает пустой список. */
      log.data ?? ('0x' as HexString),
    )

    if (movement !== null) {
      movements.push(movement)
    }
  }

  return movements
}

/**
 * Разбирает один журнал в перемещение.
 *
 * ГРАММАТИКА СОБЫТИЙ ТА ЖЕ, ЧТО У ИСТОРИИ ПЕРЕВОДОВ, и разбор здесь
 * отдельный: история собирает запись с блоком, временем и источником,
 * а подтверждение — перемещение без привязки к цепи, потому что
 * ничего этого ещё не произошло. Общими остаются признаки событий:
 * ошибиться в них дважды нельзя, они берутся из одного места.
 *
 * НЕРАЗОБРАННОЕ НЕ ОТБРАСЫВАЕТСЯ МОЛЧА там, где событие опознано:
 * количество может остаться неизвестным, но сам факт перемещения
 * доходит до экрана. Умолчание о перемещении опаснее неполноты.
 */
function readMovement(
  address: string,
  topics: readonly HexString[],
  data: HexString,
): IAssetMovement | null {
  const [topic, first, second, third] = topics

  if (topic === undefined) {
    return null
  }

  const isNative = address.toLowerCase() === NATIVE_ASSET_ADDRESS
  const contract = isNative ? null : toAddress(address)
  const words = splitDataWords(data)

  if (topic === TRANSFER_TOPIC && first !== undefined && second !== undefined) {
    const isErc721 = topics.length === ERC721_TOPIC_COUNT && third !== undefined

    return {
      kind: isNative ? MOVEMENT_KIND.Native : isErc721 ? MOVEMENT_KIND.Erc721 : MOVEMENT_KIND.Erc20,
      contract,
      from: topicToAddress(first),
      to: topicToAddress(second),
      amount: isErc721 ? 1n : (words[0] ?? null),
      tokenId: isErc721 && third !== undefined ? hexToBigInt(third) : null,
    }
  }

  if (topic === TRANSFER_SINGLE_TOPIC && second !== undefined && third !== undefined) {
    return {
      kind: MOVEMENT_KIND.Erc1155,
      contract,
      from: topicToAddress(second),
      to: topicToAddress(third),
      amount: words[1] ?? null,
      tokenId: words[0] ?? null,
    }
  }

  if (topic === TRANSFER_BATCH_TOPIC && second !== undefined && third !== undefined) {
    /* Пакетная передача содержит массивы номеров и количеств. Разбирать
       их здесь незачем: на экране подтверждения важен сам факт, что
       предметы уходят, а перечислять их по одному — задача истории,
       где событие уже состоялось. Количество остаётся неизвестным,
       и об этом сказано значением `null`, а не нулём. */
    return {
      kind: MOVEMENT_KIND.Erc1155,
      contract,
      from: topicToAddress(second),
      to: topicToAddress(third),
      amount: null,
      tokenId: null,
    }
  }

  return null
}

/** Отличает «метода нет» от прочих отказов узла. */
function isMethodNotFound(error: unknown): boolean {
  const code = (error as { rpcCode?: unknown }).rpcCode

  return code === JSON_RPC_METHOD_NOT_FOUND
}
