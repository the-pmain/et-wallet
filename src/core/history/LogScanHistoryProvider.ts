import { TRANSACTION_STATUS } from '@/core/transaction'

import { areAddressesEqual } from '@/core/address'
import type { ILogEntry, IProvider } from '@/core/provider'
import type { Address, ChainId, HexString } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  splitDataWords,
  topicToAddress,
} from './transfer-events'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const PROVIDER_ID = 'logs'
const PROVIDER_NAME = 'Журналы узла'

/**
 * Глубина выборки в блоках.
 *
 * Публичные узлы ограничивают диапазон `eth_getLogs`; десять тысяч блоков —
 * значение, которое принимают почти все. В Ethereum это около полутора
 * суток, в быстрых сетях — несколько часов.
 *
 * Увеличивать бессмысленно: узел ответит отказом, и история окажется
 * пустой вместо короткой.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/** Число тем у события ERC-721: идентификатор события плюс три параметра. */
const ERC721_TOPIC_COUNT = 4

/** Настройки источника. */
export interface ILogScanOptions {
  readonly scanBlocks?: number
}

/**
 * История по журналам узла.
 *
 * ЧТО ЭТОТ ИСТОЧНИК ВИДЕТЬ НЕ МОЖЕТ. Перевод нативной валюты не порождает
 * события и в журналах отсутствует физически. Никакая настройка этого
 * не изменит: чтобы найти такие переводы, пришлось бы перебирать каждый
 * блок целиком либо пользоваться трассировкой, которой публичные узлы
 * не предоставляют.
 *
 * Ограничение сообщается вызывающему коду полем `nativeTransfersUnavailable`,
 * а не замалчивается: пустой список без объяснения читается как
 * «переводов не было».
 *
 * ЗАЧЕМ ОН ТОГДА НУЖЕН. Работает на любом узле и без ключа, то есть
 * не требует передавать адрес пользователя стороннему сервису. Для того,
 * кто ценит приватность выше полноты, это единственный приемлемый вариант.
 */
export class LogScanHistoryProvider implements IHistoryProvider {
  readonly id = PROVIDER_ID
  readonly name = PROVIDER_NAME

  readonly #scanBlocks: number

  constructor(options: ILogScanOptions = {}) {
    this.#scanBlocks = options.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  supports(_chainId: ChainId): boolean {
    /* Журналы есть в любой сети EVM: источник не зависит от оператора. */
    return true
  }

  async fetch(query: IHistoryQuery, provider: IProvider): Promise<IHistoryPage> {
    const latest = await provider.getBlockNumber()
    const fromBlock = latest > BigInt(this.#scanBlocks) ? latest - BigInt(this.#scanBlocks) : 0n
    const ownerTopic = addressToTopic(query.owner)

    /* Шесть выборок: отправленное и полученное, отдельно для трёх
       семейств событий. Объединить их в одну нельзя — позиция адреса
       в темах у ERC-20 и ERC-1155 разная. */
    const batches = await Promise.all([
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_TOPIC, ownerTopic]),
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_TOPIC, null, ownerTopic]),
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_SINGLE_TOPIC, null, ownerTopic]),
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_SINGLE_TOPIC, null, null, ownerTopic]),
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_BATCH_TOPIC, null, ownerTopic]),
      this.#getLogs(provider, fromBlock, latest, [TRANSFER_BATCH_TOPIC, null, null, ownerTopic]),
    ])

    /*
      ОТКАЗ ВСЕХ ВЫБОРОК — ЭТО ОТКАЗ ИСТОЧНИКА, А НЕ ПУСТАЯ ИСТОРИЯ.

      Публичные узлы отвечают отказом на выборку журналов без указания
      контракта, а именно такая выборка нужна, чтобы найти переводы всех
      токенов сразу. Проглотив этот отказ, кошелёк сообщил бы владельцу
      «операций не было» — то есть утверждение о его средствах, которое
      он не проверял.

      Ошибка выбрасывается, чтобы вызывающий код перешёл к следующему
      источнику, а при его отсутствии показал настоящую причину.
    */
    const failure = batches.find((batch) => batch.error !== null)

    if (batches.every((batch) => batch.error !== null) && failure !== undefined) {
      throw new Error(failure.error ?? 'узел отказал в выборке журналов')
    }

    const transfers = batches
      .flatMap((batch) => batch.logs)
      /* Лог, отменённый реорганизацией цепи, обязан исчезнуть, а не
         остаться в истории как состоявшийся перевод. */
      .filter((log) => !log.removed)
      .flatMap((log) => this.#toRecords(log, query))

    return {
      transfers: dedupeById(transfers).slice(0, query.limit),
      limits: {
        nativeTransfersUnavailable: true,
        scannedBlocks: this.#scanBlocks,
        sourceUnavailable: false,
        /* Часть выборок могла отказать: история неполна, и об этом
           сообщается, а не умалчивается. */
        reason: failure?.error ?? null,
      },
    }
  }

  /**
   * Запрашивает журналы, сохраняя причину отказа вместо её потери.
   *
   * Отказ одной выборки не губит остальные: узел может принять запрос
   * по одному семейству событий и отвергнуть по другому. Но причина
   * запоминается — молчаливый пустой результат неотличим от отсутствия
   * операций.
   */
  async #getLogs(
    provider: IProvider,
    fromBlock: bigint,
    toBlock: bigint,
    topics: readonly (HexString | null)[],
  ): Promise<{ logs: readonly ILogEntry[]; error: string | null }> {
    try {
      return { logs: await provider.getLogs({ fromBlock, toBlock, topics }), error: null }
    } catch (error) {
      return { logs: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Превращает журнальную запись в записи истории. */
  #toRecords(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [topic] = log.topics

    if (topic === TRANSFER_TOPIC) {
      return this.#fromTransfer(log, query)
    }

    if (topic === TRANSFER_SINGLE_TOPIC) {
      return this.#fromTransferSingle(log, query)
    }

    if (topic === TRANSFER_BATCH_TOPIC) {
      return this.#fromTransferBatch(log, query)
    }

    return []
  }

  /**
   * `Transfer` — ERC-20 либо ERC-721.
   *
   * РАЗЛИЧАЮТСЯ ЧИСЛОМ ТЕМ, а не содержимым. У ERC-721 идентификатор
   * предмета индексирован и занимает четвёртую тему; у ERC-20 сумма
   * лежит в данных, и тем всего три. Признак единственный: тип
   * в событии не указан.
   */
  #fromTransfer(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, fromTopic, toTopic, tokenIdTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const isErc721 = log.topics.length === ERC721_TOPIC_COUNT && tokenIdTopic !== undefined
    const from = topicToAddress(fromTopic)
    const to = topicToAddress(toTopic)

    return [
      this.#buildRecord({
        log,
        query,
        kind: isErc721 ? TRANSFER_KIND.Erc721 : TRANSFER_KIND.Erc20,
        from,
        to,
        value: isErc721 ? 1n : (splitDataWords(log.data)[0] ?? 0n),
        tokenId: isErc721 && tokenIdTopic !== undefined ? BigInt(tokenIdTopic) : null,
        index: 0,
      }),
    ]
  }

  /** `TransferSingle` — один предмет ERC-1155. */
  #fromTransferSingle(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, , fromTopic, toTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const [tokenId = 0n, value = 0n] = splitDataWords(log.data)

    return [
      this.#buildRecord({
        log,
        query,
        kind: TRANSFER_KIND.Erc1155,
        from: topicToAddress(fromTopic),
        to: topicToAddress(toTopic),
        value,
        tokenId,
        index: 0,
      }),
    ]
  }

  /**
   * `TransferBatch` — набор предметов ERC-1155 в одном событии.
   *
   * Данные содержат два массива переменной длины в кодировке ABI:
   * сначала смещения, затем длины и сами значения. Разбор упрощён
   * до чтения длин и последовательных элементов — этого достаточно
   * для событий, где оба массива идут подряд, как их формирует
   * эталонная реализация.
   */
  #fromTransferBatch(log: ILogEntry, query: IHistoryQuery): readonly ITransferRecord[] {
    const [, , fromTopic, toTopic] = log.topics

    if (fromTopic === undefined || toTopic === undefined) {
      return []
    }

    const words = splitDataWords(log.data)
    const idsLength = Number(words[2] ?? 0n)

    if (idsLength === 0 || idsLength > words.length) {
      return []
    }

    const from = topicToAddress(fromTopic)
    const to = topicToAddress(toTopic)
    const records: ITransferRecord[] = []

    for (let item = 0; item < idsLength; item += 1) {
      const tokenId = words[3 + item]
      /* Второй массив следует за первым: его длина, затем значения. */
      const value = words[3 + idsLength + 1 + item]

      if (tokenId === undefined || value === undefined) {
        break
      }

      records.push(
        this.#buildRecord({
          log,
          query,
          kind: TRANSFER_KIND.Erc1155,
          from,
          to,
          value,
          tokenId,
          index: item,
        }),
      )
    }

    return records
  }

  #buildRecord(params: {
    log: ILogEntry
    query: IHistoryQuery
    kind: TransferKind
    from: Address
    to: Address
    value: bigint
    tokenId: bigint | null
    index: number
  }): ITransferRecord {
    const { log, query, kind, from, to, value, tokenId, index } = params
    const isOutgoing = areAddressesEqual(from, query.owner)
    const isIncoming = areAddressesEqual(to, query.owner)

    return {
      /* Ключ включает номер лога и порядковый номер внутри события:
         одна транзакция порождает десятки переводов, и хэша мало. */
      id: `${log.transactionHash}:${String(log.logIndex)}:${String(index)}`,
      hash: log.transactionHash,
      chainId: query.chainId,
      kind,
      direction:
        isOutgoing && isIncoming
          ? TRANSFER_DIRECTION.Self
          : isOutgoing
            ? TRANSFER_DIRECTION.Outgoing
            : TRANSFER_DIRECTION.Incoming,
      from,
      to,
      value,
      tokenId,
      asset: {
        contract: log.address,
        /* Символ и число знаков журнал не содержит. Запрашивать их
           у контракта на каждую запись — сотни вызовов на один экран;
           `null` честно означает «неизвестно». */
        symbol: null,
        decimals: null,
      },
      blockNumber: log.blockNumber,
      timestamp: null,
      source: TRANSFER_SOURCE.Logs,
      /* Запись существует только потому, что уже попала в блок. */
      status: TRANSACTION_STATUS.Confirmed,
    }
  }
}

/** Убирает повторы: один перевод попадает и в выборку «отправлено», и в «получено». */
function dedupeById(records: readonly ITransferRecord[]): readonly ITransferRecord[] {
  const seen = new Map<string, ITransferRecord>()

  for (const record of records) {
    seen.set(record.id, record)
  }

  return [...seen.values()].sort((left, right) => Number(right.blockNumber - left.blockNumber))
}
