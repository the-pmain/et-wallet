import { toAddress } from '@/core/address'
import type { ILogger } from '@/core/platform'
import {
  MOVEMENT_KIND,
  SIMULATION_OUTCOME,
  type IAssetMovement,
  type ISimulationRequest,
  type ISimulationResult,
  type MovementKind,
} from '@/core/transaction'
import type { Address, ChainId } from '@/core/types'

import type { ISimulationSource } from './contracts'

const SOURCE_ID = 'tenderly'
const SOURCE_NAME = 'Tenderly'

const DEFAULT_BASE_URL = 'https://api.tenderly.co/api/v1'

/** Предел ожидания ответа. Симуляция стоит между нажатием и подписью. */
const DEFAULT_TIMEOUT_MS = 8000

/** Учётные данные Tenderly. Без любого из трёх источник не работает. */
export interface ITenderlyCredentials {
  readonly account: string
  readonly project: string
  readonly accessKey: string
}

export interface ITenderlyOptions {
  readonly credentials: ITenderlyCredentials
  readonly logger: ILogger
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

/**
 * Симуляция через Tenderly.
 *
 * ЧТО ЭТОТ ИСТОЧНИК ДОБАВЛЯЕТ К УЗЛУ. Узел отвечает журналами событий,
 * и перемещения приходится собирать из них самим: перевод эфира событий
 * не порождает вовсе, а токен без события `Transfer` в списке
 * не появится. Tenderly отдаёт разобранные изменения балансов, включая
 * нативную валюту и внутренние вызовы. Плюс он не отказывает
 * по частоте: измерено, что публичные шлюзы отвечают на `eth_simulateV1`
 * отказом `-32005`, а половина публичных узлов метода не знает вовсе.
 *
 * ЧЕГО ЭТОТ ИСТОЧНИК СТОИТ. Каждый запрос сообщает оператору адрес
 * владельца, получателя, сумму и данные вызова — то есть намерение
 * потратить, ДО подписи. Это больше, чем узнаёт узел: узел видит
 * транзакцию, уже ушедшую в сеть, а здесь видно и то, от чего владелец
 * в итоге отказался. Поэтому источник включается только по явному
 * согласию и никогда не бывает включён по умолчанию.
 *
 * `save` И `save_if_fails` ВСЕГДА ЛОЖНЫ. По умолчанию сервис сохраняет
 * симуляцию в панели проекта — то есть намерения владельца оседали бы
 * на чужих серверах навсегда. Отправляется явное «не сохранять».
 */
export class TenderlySimulationProvider implements ISimulationSource {
  readonly id = SOURCE_ID
  readonly name = SOURCE_NAME

  readonly #credentials: ITenderlyCredentials
  readonly #logger: ILogger
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: ITenderlyOptions) {
    this.#credentials = options.credentials
    this.#logger = options.logger.child(SOURCE_NAME)
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Сети не перечисляются списком намеренно.
   *
   * Tenderly поддерживает десятки сетей и добавляет новые; зашитый
   * перечень устарел бы молча и отключал бы источник там, где он
   * работает. Неподдерживаемая сеть распознаётся по ответу, и это
   * обычный отказ — запасной путь через узел остаётся.
   */
  isAvailable(): boolean {
    return (
      this.#credentials.account !== '' &&
      this.#credentials.project !== '' &&
      this.#credentials.accessKey !== ''
    )
  }

  async simulate(request: ISimulationRequest, chainId: ChainId): Promise<ISimulationResult | null> {
    if (!this.isAvailable()) {
      return null
    }

    const { account, project, accessKey } = this.#credentials
    const url = `${this.#baseUrl}/account/${account}/project/${project}/simulate`

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, this.#timeoutMs)

    try {
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          /* Ключ уходит заголовком, а не в строке запроса: строка
             запроса оседает в журналах промежуточных узлов. */
          'X-Access-Key': accessKey,
        },
        body: JSON.stringify({
          network_id: chainId.toString(),
          from: request.from,
          to: request.to,
          input: request.data,
          value: request.value.toString(),
          save: false,
          save_if_fails: false,
          simulation_type: 'full',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        this.#logger.warn('Tenderly refused the simulation', { status: response.status })

        return null
      }

      return parseSimulation(await response.json())
    } catch (error) {
      this.#logger.warn('Tenderly did not answer', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Разбирает ответ Tenderly.
 *
 * ФОРМА ОТВЕТА НЕ ИЗМЕРЕНА НА ЖИВОМ СЕРВИСЕ. Она взята из описания,
 * и в этом проекте так уже обжигались: псевдоадрес нативной валюты
 * пришлось мерить на живом узле, потому что реализации разошлись
 * с соглашением. Поэтому разбор строгий и при любой неожиданности
 * возвращает `null` — «ответить не смог», после чего спрашивается узел.
 *
 * ЭТО НЕ ПЕРЕСТРАХОВКА. Мягкий разбор, пропускающий непонятое, выдал бы
 * «выполнено, перемещений нет» — а пустой список при успехе означает
 * «транзакция не двигает средства». Владелец прочитал бы это как
 * подтверждение безопасности вызова, который на деле выносит кошелёк.
 *
 * ПЕРВЫЙ ЖИВОЙ ОТВЕТ ОБЯЗАН БЫТЬ СВЕРЕН с этим разбором, и до тех пор
 * источник следует считать непроверенным.
 */
export function parseSimulation(payload: unknown): ISimulationResult | null {
  if (!isRecord(payload)) {
    return null
  }

  const simulation = payload['simulation']

  if (!isRecord(simulation)) {
    return null
  }

  const status = simulation['status']

  if (typeof status !== 'boolean') {
    return null
  }

  const gasUsed = readBigInt(simulation['gas_used'])
  const reason =
    typeof simulation['error_message'] === 'string' ? simulation['error_message'] : null

  if (!status) {
    /* Откат: перемещений не будет, и пустой список здесь означает
       именно это, а не «разобрать не удалось». */
    return {
      outcome: SIMULATION_OUTCOME.Reverted,
      gasUsed,
      movements: [],
      reason,
    }
  }

  const movements = readMovements(payload)

  if (movements === null) {
    return null
  }

  return {
    outcome: SIMULATION_OUTCOME.Succeeded,
    gasUsed,
    movements,
    reason: null,
  }
}

/**
 * Читает изменения балансов.
 *
 * `null` — поле отсутствует либо устроено не так, как здесь ожидается.
 * Отсутствие поля НЕ равнозначно отсутствию перемещений: сервис мог
 * не прислать его по десятку причин, и выдать это за «средства
 * не двигаются» нельзя.
 */
function readMovements(payload: Record<string, unknown>): readonly IAssetMovement[] | null {
  const transaction = payload['transaction']

  if (!isRecord(transaction)) {
    return null
  }

  const info = transaction['transaction_info']

  if (!isRecord(info)) {
    return null
  }

  const changes = info['asset_changes']

  /* Пустой массив — законный ответ: транзакция ничего не двигает.
     Отсутствие поля — нет, это молчание. */
  if (changes === null || changes === undefined) {
    return null
  }

  if (!Array.isArray(changes)) {
    return null
  }

  const movements: IAssetMovement[] = []

  for (const change of changes) {
    const movement = readMovement(change)

    if (movement === null) {
      return null
    }

    movements.push(movement)
  }

  return movements
}

function readMovement(change: unknown): IAssetMovement | null {
  if (!isRecord(change)) {
    return null
  }

  const from = readAddress(change['from'])
  const to = readAddress(change['to'])

  if (from === null || to === null) {
    return null
  }

  const tokenInfo = isRecord(change['token_info']) ? change['token_info'] : null
  const contract = tokenInfo === null ? null : readAddress(tokenInfo['contract_address'])
  const kind = readKind(tokenInfo?.['standard'], contract)

  if (kind === null) {
    return null
  }

  return {
    kind,
    contract: kind === MOVEMENT_KIND.Native ? null : contract,
    from,
    to,
    /* `raw_amount` — количество в наименьших единицах. Поле `amount`
       у того же изменения приходит дробным числом и для показа
       не годится: кошелёк считает суммы целыми. */
    amount: readBigInt(change['raw_amount']),
    tokenId: readBigInt(change['token_id']),
  }
}

/** Соответствие видов. Неизвестный вид — повод промолчать, а не гадать. */
function readKind(standard: unknown, contract: Address | null): MovementKind | null {
  if (contract === null) {
    return MOVEMENT_KIND.Native
  }

  if (typeof standard !== 'string') {
    return null
  }

  switch (standard.toUpperCase()) {
    case 'ERC20':
      return MOVEMENT_KIND.Erc20
    case 'ERC721':
      return MOVEMENT_KIND.Erc721
    case 'ERC1155':
      return MOVEMENT_KIND.Erc1155
    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAddress(value: unknown): Address | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return toAddress(value)
  } catch {
    return null
  }
}

/** Число приходит строкой. `null` — поля нет либо оно не число. */
function readBigInt(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  if (typeof value !== 'string' || value === '') {
    return null
  }

  try {
    return BigInt(value)
  } catch {
    return null
  }
}
