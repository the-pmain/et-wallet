import { areAddressesEqual, isValidAddress, toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { IProvider } from '@/core/provider'
import type { Address, ChainId, Timestamp, TxHash } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import { hexToBigInt } from './transfer-events'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const PROVIDER_ID = 'alchemy'
const PROVIDER_NAME = 'Индексатор Alchemy'

/** Метод индексатора. Не входит в стандарт JSON-RPC. */
const METHOD = 'alchemy_getAssetTransfers'

/**
 * Запрашиваемые категории.
 *
 * `external` — обычные переводы нативной валюты, `internal` — переводы,
 * выполненные контрактом внутри транзакции. Именно эти две категории
 * недостижимы разбором журналов: событий они не порождают.
 */
const CATEGORIES: readonly string[] = ['external', 'internal', 'erc20', 'erc721', 'erc1155']

/** Сети, которые обслуживает индексатор. Совпадают с сетями RPC-источника. */
const SUPPORTED: ReadonlySet<ChainId> = new Set([
  BUILT_IN_CHAIN_ID.Ethereum,
  BUILT_IN_CHAIN_ID.Optimism,
  BUILT_IN_CHAIN_ID.BnbChain,
  BUILT_IN_CHAIN_ID.Polygon,
  BUILT_IN_CHAIN_ID.Base,
  BUILT_IN_CHAIN_ID.Arbitrum,
  BUILT_IN_CHAIN_ID.Avalanche,
])

/**
 * История переводов через индексатор Alchemy.
 *
 * ЧТО ПОЛУЧАЕМ. Полную историю всех категорий, включая переводы нативной
 * валюты и внутренние переводы контрактов, за всё время существования
 * адреса. Разбором журналов это недостижимо.
 *
 * ЧЕМ ПЛАТИМ. Оператор индексатора получает адрес пользователя и
 * возвращает всю его финансовую историю. Он узнаёт размер портфеля,
 * всех контрагентов и время каждой операции — разом, а не по мере
 * поступления запросов, как это происходит с обычным RPC-узлом.
 * Решение о таком обмене принимает владелец кошелька, и интерфейс
 * обязан показывать, какой источник использован.
 *
 * ПОЧЕМУ СУММА БЕРЁТСЯ ИЗ `rawContract.value`, А НЕ ИЗ `value`.
 * Поле `value` приходит числом JSON, то есть двоичной плавающей точкой:
 * баланс в 0.1 токена в ней непредставим точно, а суммы свыше 2^53
 * теряют младшие разряды целиком. Для денег это недопустимо. Поле
 * `rawContract.value` содержит необработанные единицы шестнадцатеричной
 * строкой и переводится в `bigint` без потерь.
 */
export class AlchemyHistoryProvider implements IHistoryProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  supports(chainId: ChainId): boolean {
    return SUPPORTED.has(chainId)
  }

  async fetch(query: IHistoryQuery, provider: IProvider): Promise<IHistoryPage> {
    /* Индексатор не умеет объединять условия «отправитель ИЛИ получатель»,
       поэтому выборок две. Запрашиваются параллельно: последовательные
       удвоили бы ожидание на экране, который открывают ради быстрого
       взгляда. */
    const [sent, received] = await Promise.all([
      this.#request(provider, query, 'fromAddress'),
      this.#request(provider, query, 'toAddress'),
    ])

    const transfers = [...sent, ...received]
      .flatMap((raw) => this.#toRecords(raw, query))
      .sort((left, right) => Number(right.blockNumber - left.blockNumber))

    return {
      transfers: dedupeById(transfers).slice(0, query.limit),
      limits: {
        nativeTransfersUnavailable: false,
        scannedBlocks: null,
        sourceUnavailable: false,
        reason: null,
      },
    }
  }

  async #request(
    provider: IProvider,
    query: IHistoryQuery,
    direction: 'fromAddress' | 'toAddress',
  ): Promise<readonly IRawTransfer[]> {
    const response = await provider.request<unknown>({
      method: METHOD,
      params: [
        {
          fromBlock: '0x0',
          toBlock: 'latest',
          [direction]: query.owner,
          category: CATEGORIES,
          withMetadata: true,
          excludeZeroValue: false,
          order: 'desc',
          maxCount: `0x${query.limit.toString(16)}`,
        },
      ],
    })

    return extractTransfers(response)
  }

  /**
   * Превращает запись индексатора в записи истории.
   *
   * Одно событие ERC-1155 может нести несколько предметов, поэтому
   * возвращается список, а не одна запись.
   */
  #toRecords(raw: IRawTransfer, query: IHistoryQuery): readonly ITransferRecord[] {
    const kind = toKind(raw.category)

    if (kind === null || !isValidAddress(raw.from)) {
      return []
    }

    const from = toAddress(raw.from)
    const to = raw.to !== null && isValidAddress(raw.to) ? toAddress(raw.to) : null
    const base = {
      hash: raw.hash as TxHash,
      chainId: query.chainId,
      kind,
      direction: resolveDirection(from, to, query.owner),
      from,
      to,
      asset: {
        contract:
          raw.contractAddress !== null && isValidAddress(raw.contractAddress)
            ? toAddress(raw.contractAddress)
            : null,
        symbol: raw.asset,
        decimals: raw.decimals,
      },
      blockNumber: raw.blockNumber,
      timestamp: raw.timestamp,
      source: TRANSFER_SOURCE.Indexer,
    }

    if (raw.erc1155Items.length > 0) {
      return raw.erc1155Items.map((item, index) => ({
        ...base,
        id: `${raw.uniqueId}:${String(index)}`,
        value: item.value,
        tokenId: item.tokenId,
      }))
    }

    return [
      {
        ...base,
        id: raw.uniqueId,
        /* Для ERC-721 количество всегда единица: уникальный предмет
           не делится, а поле суммы индексатор для него не заполняет. */
        value: kind === TRANSFER_KIND.Erc721 ? 1n : raw.rawValue,
        tokenId: raw.tokenId,
      },
    ]
  }
}

/** Запись ответа индексатора после проверки. */
interface IRawTransfer {
  readonly uniqueId: string
  readonly hash: string
  readonly category: string
  readonly from: string
  readonly to: string | null
  readonly rawValue: bigint
  readonly tokenId: bigint | null
  readonly erc1155Items: readonly { tokenId: bigint; value: bigint }[]
  readonly contractAddress: string | null
  readonly asset: string | null
  readonly decimals: number | null
  readonly blockNumber: bigint
  readonly timestamp: Timestamp | null
}

/**
 * Разбирает ответ индексатора.
 *
 * Ответ НЕДОВЕРЕННЫЙ: это внешний сервис, и его формат может измениться
 * без предупреждения. Каждое поле проверяется по отдельности, а записи,
 * не прошедшие проверку, отбрасываются молча. Исключение здесь означало бы,
 * что одна испорченная запись лишает пользователя всей истории.
 */
function extractTransfers(response: unknown): readonly IRawTransfer[] {
  if (typeof response !== 'object' || response === null) {
    return []
  }

  const { transfers } = response as { transfers?: unknown }

  if (!Array.isArray(transfers)) {
    return []
  }

  const parsed: IRawTransfer[] = []

  for (const entry of transfers as readonly unknown[]) {
    const record = parseTransfer(entry)

    if (record !== null) {
      parsed.push(record)
    }
  }

  return parsed
}

function parseTransfer(entry: unknown): IRawTransfer | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const value = entry as Record<string, unknown>
  const uniqueId = readString(value, 'uniqueId')
  const hash = readString(value, 'hash')
  const category = readString(value, 'category')
  const from = readString(value, 'from')
  const blockNum = readString(value, 'blockNum')

  if (uniqueId === null || hash === null || category === null || from === null) {
    return null
  }

  const rawContract = asRecord(field(value, 'rawContract'))

  return {
    uniqueId,
    hash,
    category,
    from,
    to: readString(value, 'to'),
    rawValue: rawContract === null ? 0n : hexToBigInt(readString(rawContract, 'value') ?? '0x0'),
    tokenId: parseTokenId(value),
    erc1155Items: parseErc1155(field(value, 'erc1155Metadata')),
    contractAddress: rawContract === null ? null : readString(rawContract, 'address'),
    asset: readString(value, 'asset'),
    decimals: parseDecimals(rawContract),
    blockNumber: blockNum === null ? 0n : hexToBigInt(blockNum),
    timestamp: parseTimestamp(field(value, 'metadata')),
  }
}

/**
 * Число десятичных знаков.
 *
 * Отсутствие поля означает «неизвестно» и передаётся как `null`.
 * Подставлять привычные восемнадцать нельзя: токен с шестью знаками,
 * показанный как восемнадцатизначный, занизит сумму в триллион раз.
 */
function parseDecimals(rawContract: Record<string, unknown> | null): number | null {
  if (rawContract === null) {
    return null
  }

  const decimal = readString(rawContract, 'decimal')

  if (decimal === null) {
    return null
  }

  const parsed = Number(hexToBigInt(decimal))

  return Number.isFinite(parsed) ? parsed : null
}

function parseTokenId(value: Record<string, unknown>): bigint | null {
  const raw = readString(value, 'erc721TokenId') ?? readString(value, 'tokenId')

  if (raw === null) {
    return null
  }

  try {
    return hexToBigInt(raw)
  } catch {
    return null
  }
}

function parseErc1155(value: unknown): readonly { tokenId: bigint; value: bigint }[] {
  if (!Array.isArray(value)) {
    return []
  }

  const items: { tokenId: bigint; value: bigint }[] = []

  for (const entry of value as readonly unknown[]) {
    const record = asRecord(entry)
    const tokenId = record === null ? null : readString(record, 'tokenId')
    const amount = record === null ? null : readString(record, 'value')

    if (tokenId === null) {
      continue
    }

    items.push({ tokenId: hexToBigInt(tokenId), value: amount === null ? 1n : hexToBigInt(amount) })
  }

  return items
}

/** Время включения в блок из метаданных. Индексатор отдаёт его строкой ISO. */
function parseTimestamp(metadata: unknown): Timestamp | null {
  const record = asRecord(metadata)
  const value = record === null ? null : readString(record, 'blockTimestamp')

  if (value === null) {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : (parsed as Timestamp)
}

function toKind(category: string): TransferKind | null {
  switch (category) {
    case 'external':
    case 'internal':
      return TRANSFER_KIND.Native
    case 'erc20':
      return TRANSFER_KIND.Erc20
    case 'erc721':
      return TRANSFER_KIND.Erc721
    case 'erc1155':
      return TRANSFER_KIND.Erc1155
    default:
      return null
  }
}

function resolveDirection(from: Address, to: Address | null, owner: Address) {
  const isOutgoing = areAddressesEqual(from, owner)
  const isIncoming = to !== null && areAddressesEqual(to, owner)

  if (isOutgoing && isIncoming) {
    return TRANSFER_DIRECTION.Self
  }

  return isOutgoing ? TRANSFER_DIRECTION.Outgoing : TRANSFER_DIRECTION.Incoming
}

/**
 * Чтение поля недоверенного объекта.
 *
 * Отдельный помощник, а не прямой доступ: настройка
 * `noPropertyAccessFromIndexSignature` требует скобочной записи для
 * полей, чьё существование не гарантировано типом. Это верное
 * требование — оно не даёт спутать разобранную структуру с сырым
 * ответом стороннего сервиса.
 */
function field(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return asString(field(record, key))
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function dedupeById(records: readonly ITransferRecord[]): readonly ITransferRecord[] {
  const seen = new Map<string, ITransferRecord>()

  for (const record of records) {
    seen.set(record.id, record)
  }

  return [...seen.values()]
}
