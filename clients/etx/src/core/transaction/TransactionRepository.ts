import type { ISecureStorage } from '@/core/encryption'
import { STORAGE_NAMESPACE, toStorageKey, type StorageKey } from '@/core/storage'
import { toChainId, type Address, type ChainId, type Timestamp, type TxHash } from '@/core/types'

import type { ITransactionRepository } from './contracts'
import {
  TRANSACTION_STATUS,
  type ITransactionRecord,
  type TransactionStatus,
  type TransactionType,
} from './types'

/**
 * Запись истории в виде, пригодном для JSON.
 *
 * ПОЧЕМУ НУЖЕН ОТДЕЛЬНЫЙ ТИП. `JSON.stringify` выбрасывает исключение
 * на `bigint`, а не преобразует его. Полагаться на автоматическую
 * сериализацию доменной записи нельзя: добавление ещё одного денежного
 * поля молча сломало бы сохранение истории.
 *
 * Все крупные числа хранятся десятичными строками. Шестнадцатеричная запись
 * была бы компактнее, но требует согласия о знаке и о ведущих нулях.
 */
interface IStoredRecord {
  readonly hash: string
  readonly chainId: string
  readonly from: string
  readonly to: string | null
  readonly value: string
  readonly nonce: number
  readonly status: string
  readonly type: string
  readonly submittedAt: number
  readonly confirmedAt: number | null
  readonly blockNumber: string | null
  readonly gasUsed: string | null
  readonly effectiveGasPrice: string | null
  readonly replacedBy: string | null

  /**
   * Число подтверждений.
   *
   * Необязательно ради записей, сохранённых до появления отслеживания:
   * прочитанные без него считаются неподтверждёнными, а не портят
   * разбор. Кошелёк обязан открывать хранилище, созданное прежней
   * версией, — иначе обновление приложения означало бы потерю истории.
   */
  readonly confirmations?: number

  /** Параметры исходной транзакции. Необязательны у прежних записей. */
  readonly data?: string | null
  readonly gasLimit?: string | null
  readonly maxFeePerGas?: string | null
  readonly maxPriorityFeePerGas?: string | null
  readonly gasPrice?: string | null
}

/**
 * История транзакций в зашифрованном хранилище.
 *
 * ПОЧЕМУ ШИФРУЕТСЯ. Сама по себе транзакция публична: она лежит в блокчейне
 * и видна любому. Но список транзакций кошелька связывает между собой все
 * адреса пользователя и раскрывает контрагентов, суммы и время активности.
 * Заблокированный кошелёк не должен сообщать этого.
 *
 * КЛЮЧ ЗАПИСИ — ХЭШ, А НЕ ПОРЯДКОВЫЙ НОМЕР. Хэш уникален и известен заранее,
 * поэтому повторное сохранение той же транзакции обновляет запись, а не
 * создаёт дубль. Порядковый номер потребовал бы отдельного счётчика,
 * который расходится при параллельной записи.
 *
 * ОГРАНИЧЕНИЕ ТЕКУЩЕГО ЭТАПА. Репозиторий хранит только транзакции,
 * отправленные этим кошельком. Полная история адреса, включая входящие
 * переводы, из узла не читается: `eth_getLogs` отдаёт лишь события
 * контрактов, а переводы нативной валюты событий не порождают. Для полной
 * истории нужен внешний индексатор, а это раскрытие всех адресов
 * пользователя стороннему сервису — решение, требующее согласия владельца.
 */
export class TransactionRepository implements ITransactionRepository {
  readonly #storage: ISecureStorage

  constructor(storage: ISecureStorage) {
    this.#storage = storage
  }

  async findByAddress(address: Address, chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    const index = await this.#readIndex()
    const hashes = index.byOwner[ownerKey(address, chainId)]

    /* Отсутствие ключа означает «этот адрес в индексе не встречался».
       Это не то же самое, что «индекса нет»: он уже построен выше,
       и построение читает всё, что есть в хранилище. */
    const records = await this.#readByHashes(hashes ?? [])

    return [...records].sort((left, right) => right.submittedAt - left.submittedAt)
  }

  async findByHash(hash: TxHash): Promise<ITransactionRecord | null> {
    const stored = await this.#storage.get<IStoredRecord>(
      STORAGE_NAMESPACE.Transactions,
      recordKey(hash),
    )

    return stored === null ? null : decode(stored)
  }

  async findPending(chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    const index = await this.#readIndex()
    const records = await this.#readByHashes(index.unsettled)

    return records.filter(
      (record) => record.chainId === chainId && record.status === TRANSACTION_STATUS.Pending,
    )
  }

  async findUnsettled(maxConfirmations: number): Promise<readonly ITransactionRecord[]> {
    /* Читаются только незавершённые: их единицы, тогда как всех записей
       могут быть тысячи. Слежение обращается сюда каждые двенадцать
       секунд, и полное чтение стоило бы десятков миллисекунд
       расшифровки на каждом проходе. */
    const index = await this.#readIndex()
    const records = await this.#readByHashes(index.unsettled)

    return records.filter((record) => {
      if (record.status === TRANSACTION_STATUS.Pending) {
        return true
      }

      /* Замещённая транзакция окончательна: её место занято, и вернуть
         её в цепь нечем. */
      if (record.status === TRANSACTION_STATUS.Replaced) {
        return false
      }

      /* Включённая в блок, но неглубоко: реорганизация ещё возможна. */
      return record.confirmations < maxConfirmations
    })
  }

  async save(record: ITransactionRecord): Promise<void> {
    /* ЗАПИСЬ СОХРАНЯЕТСЯ ПЕРВОЙ. Индекс — ускоритель, а не источник
       истины: запись без индекса найдётся при его перестроении,
       а индекс без записи означал бы ссылку в пустоту. */
    await this.#storage.set(STORAGE_NAMESPACE.Transactions, recordKey(record.hash), encode(record))
    await this.#updateIndex(record)
  }

  async updateStatus(hash: TxHash, status: TransactionStatus): Promise<void> {
    const existing = await this.findByHash(hash)

    if (existing === null) {
      return
    }

    await this.save({ ...existing, status })
  }

  async deleteByAddress(address: Address): Promise<void> {
    const records = await this.#readAll()
    const removed = new Set<string>()

    for (const record of records) {
      if (record.from.toLowerCase() === address.toLowerCase()) {
        await this.#storage.remove(STORAGE_NAMESPACE.Transactions, recordKey(record.hash))
        removed.add(record.hash.toLowerCase())
      }
    }

    if (removed.size === 0) {
      return
    }

    /* Индекс перестраивается целиком, а не правится точечно: удаление
       редкое, а построение по уже прочитанным записям ничего не стоит. */
    await this.#writeIndex(
      buildIndex(records.filter((record) => !removed.has(record.hash.toLowerCase()))),
    )
  }

  /**
   * Индекс: где искать записи, не читая их все.
   *
   * ЗАЧЕМ. Записи лежат зашифрованными по одной, и полное чтение
   * расшифровывает каждую. Замер до появления индекса: сто записей —
   * восемь миллисекунд, пятьсот — семьдесят. Слежение спрашивало
   * незавершённые каждые двенадцать секунд, поэтому цена росла линейно
   * и платилась постоянно.
   *
   * ИНДЕКС — УСКОРИТЕЛЬ, А НЕ ИСТОЧНИК ИСТИНЫ. Его отсутствие ничего
   * не теряет: он перестраивается полным чтением — тем самым, что было
   * единственным путём раньше. Поэтому запись сохраняется первой,
   * а индекс обновляется после неё.
   */
  async #readIndex(): Promise<IStoredIndex> {
    const stored = await this.#storage.get<IStoredIndex>(STORAGE_NAMESPACE.Transactions, INDEX_KEY)

    if (stored !== null && stored.version === INDEX_VERSION) {
      return stored
    }

    /* Индекса нет либо его формат сменился. Перестроение — единственный
       способ не потерять записи, сделанные прежней версией. */
    const index = buildIndex(await this.#readAll())

    await this.#writeIndex(index)

    return index
  }

  async #writeIndex(index: IStoredIndex): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Transactions, INDEX_KEY, index)
  }

  /** Вносит запись в индекс, не перечитывая остальные. */
  async #updateIndex(record: ITransactionRecord): Promise<void> {
    const index = await this.#readIndex()
    const key = ownerKey(record.from, record.chainId)
    const hash = record.hash.toLowerCase()

    const owned = index.byOwner[key] ?? []
    const byOwner = owned.includes(hash)
      ? index.byOwner
      : { ...index.byOwner, [key]: [...owned, hash] }

    /* Завершённые уходят из списка слежения и перестают читаться
       на каждом его проходе. */
    const unsettled = isUnsettled(record)
      ? index.unsettled.includes(hash)
        ? index.unsettled
        : [...index.unsettled, hash]
      : index.unsettled.filter((item) => item !== hash)

    await this.#writeIndex({ version: INDEX_VERSION, byOwner, unsettled })
  }

  /** Читает записи по списку хэшей, пропуская исчезнувшие. */
  async #readByHashes(hashes: readonly string[]): Promise<readonly ITransactionRecord[]> {
    const records: ITransactionRecord[] = []

    for (const hash of hashes) {
      const stored = await this.#storage.get<IStoredRecord>(
        STORAGE_NAMESPACE.Transactions,
        toStorageKey(`tx.${hash}`),
      )

      /* Записи может не быть: индекс переживает удаление, сделанное
         в обход репозитория. Ссылка в пустоту не ошибка — она просто
         пропускается. */
      if (stored !== null) {
        records.push(decode(stored))
      }
    }

    return records
  }

  async #readAll(): Promise<readonly ITransactionRecord[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Transactions)
    const records: ITransactionRecord[] = []

    for (const key of keys) {
      /* Индекс лежит в том же пространстве и записью транзакции
         не является. */
      if (key === INDEX_KEY) {
        continue
      }

      const stored = await this.#storage.get<IStoredRecord>(STORAGE_NAMESPACE.Transactions, key)

      if (stored !== null) {
        records.push(decode(stored))
      }
    }

    return records
  }
}

function recordKey(hash: TxHash): StorageKey {
  return toStorageKey(`tx.${hash.toLowerCase()}`)
}

function encode(record: ITransactionRecord): IStoredRecord {
  return {
    hash: record.hash,
    chainId: record.chainId.toString(),
    from: record.from,
    to: record.to,
    value: record.value.toString(),
    nonce: record.nonce,
    status: record.status,
    type: record.type,
    submittedAt: record.submittedAt,
    confirmedAt: record.confirmedAt,
    blockNumber: record.blockNumber === null ? null : record.blockNumber.toString(),
    gasUsed: record.gasUsed === null ? null : record.gasUsed.toString(),
    effectiveGasPrice:
      record.effectiveGasPrice === null ? null : record.effectiveGasPrice.toString(),
    replacedBy: record.replacedBy,
    confirmations: record.confirmations,
    data: record.data,
    gasLimit: record.gasLimit === null ? null : record.gasLimit.toString(),
    maxFeePerGas: record.maxFeePerGas === null ? null : record.maxFeePerGas.toString(),
    maxPriorityFeePerGas:
      record.maxPriorityFeePerGas === null ? null : record.maxPriorityFeePerGas.toString(),
    gasPrice: record.gasPrice === null ? null : record.gasPrice.toString(),
  }
}

function decode(stored: IStoredRecord): ITransactionRecord {
  return {
    hash: stored.hash as TxHash,
    chainId: toChainId(BigInt(stored.chainId)),
    from: stored.from as Address,
    to: stored.to as Address | null,
    value: BigInt(stored.value) as ITransactionRecord['value'],
    nonce: stored.nonce,
    status: stored.status as TransactionStatus,
    type: stored.type as TransactionType,
    submittedAt: stored.submittedAt as Timestamp,
    confirmedAt: stored.confirmedAt as Timestamp | null,
    blockNumber: stored.blockNumber === null ? null : BigInt(stored.blockNumber),
    gasUsed: stored.gasUsed === null ? null : BigInt(stored.gasUsed),
    effectiveGasPrice: stored.effectiveGasPrice === null ? null : BigInt(stored.effectiveGasPrice),
    replacedBy: stored.replacedBy as TxHash | null,
    confirmations: stored.confirmations ?? 0,
    data: (stored.data ?? null) as ITransactionRecord['data'],
    gasLimit: toBigIntOrNull(stored.gasLimit),
    maxFeePerGas: toBigIntOrNull(stored.maxFeePerGas),
    maxPriorityFeePerGas: toBigIntOrNull(stored.maxPriorityFeePerGas),
    gasPrice: toBigIntOrNull(stored.gasPrice),
  }
}

/** Читает необязательное большое число. */
function toBigIntOrNull(value: string | null | undefined): bigint | null {
  return value === null || value === undefined ? null : BigInt(value)
}

/** Версия формата индекса. Смена значения перестраивает его. */
const INDEX_VERSION = 1

/** Ключ записи индекса. Отличается от ключей транзакций префиксом. */
const INDEX_KEY = toStorageKey('index.v1')

/** Индекс в хранилище. */
interface IStoredIndex {
  readonly version: number

  /** Хэши по ключу «сеть плюс адрес отправителя». */
  readonly byOwner: Readonly<Record<string, readonly string[]>>

  /** Хэши записей, за которыми ещё следят. */
  readonly unsettled: readonly string[]
}

/** Ключ владельца: сеть и адрес в нижнем регистре. */
function ownerKey(address: Address, chainId: ChainId): string {
  return `${chainId.toString()}:${address.toLowerCase()}`
}

/**
 * Глубина, начиная с которой запись выпадает из индекса слежения.
 *
 * НАМЕРЕННО БОЛЬШЕ ЛЮБОГО ПРАКТИЧЕСКОГО ПОРОГА. Порог задаёт слой
 * транзакций (сейчас три подтверждения) и вправе его менять; индекс
 * переживает такие изменения только если отсеивает заведомо большее.
 * Двенадцать блоков — глубина, ниже которой реорганизации в сетях EVM
 * после перехода на Proof-of-Stake не наблюдаются.
 *
 * ЗАПАС РАБОТАЕТ В БЕЗОПАСНУЮ СТОРОНУ: в индексе остаются лишние
 * записи, а не пропадают нужные. Лишняя стоит одного чтения на проход,
 * пропавшая означала бы, что кошелёк перестал следить за транзакцией.
 */
const INDEX_SETTLED_DEPTH = 12

/**
 * Нужно ли следить за записью дальше.
 *
 * Отсеивается только окончательное: замещённые записи и те, что ушли
 * в цепь достаточно глубоко. Без второго условия индекс слежения
 * совпадал бы со всей историей, и выигрыш от него исчез бы: замер
 * показывал те же тридцать миллисекунд на пятистах записях.
 */
function isUnsettled(record: ITransactionRecord): boolean {
  if (record.status === TRANSACTION_STATUS.Replaced) {
    return false
  }

  if (record.status === TRANSACTION_STATUS.Pending) {
    return true
  }

  return record.confirmations < INDEX_SETTLED_DEPTH
}

/** Строит индекс по полному набору записей. */
function buildIndex(records: readonly ITransactionRecord[]): IStoredIndex {
  const byOwner: Record<string, string[]> = {}
  const unsettled: string[] = []

  for (const record of records) {
    const key = ownerKey(record.from, record.chainId)
    const hash = record.hash.toLowerCase()

    byOwner[key] = [...(byOwner[key] ?? []), hash]

    if (isUnsettled(record)) {
      unsettled.push(hash)
    }
  }

  return { version: INDEX_VERSION, byOwner, unsettled }
}
