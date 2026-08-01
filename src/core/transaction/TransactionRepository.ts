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
    const records = await this.#readAll()

    return records
      .filter(
        (record) =>
          record.chainId === chainId && record.from.toLowerCase() === address.toLowerCase(),
      )
      .sort((left, right) => right.submittedAt - left.submittedAt)
  }

  async findByHash(hash: TxHash): Promise<ITransactionRecord | null> {
    const stored = await this.#storage.get<IStoredRecord>(
      STORAGE_NAMESPACE.Transactions,
      recordKey(hash),
    )

    return stored === null ? null : decode(stored)
  }

  async findPending(chainId: ChainId): Promise<readonly ITransactionRecord[]> {
    const records = await this.#readAll()

    return records.filter(
      (record) => record.chainId === chainId && record.status === TRANSACTION_STATUS.Pending,
    )
  }

  async findUnsettled(maxConfirmations: number): Promise<readonly ITransactionRecord[]> {
    const records = await this.#readAll()

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
    await this.#storage.set(STORAGE_NAMESPACE.Transactions, recordKey(record.hash), encode(record))
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

    for (const record of records) {
      if (record.from.toLowerCase() === address.toLowerCase()) {
        await this.#storage.remove(STORAGE_NAMESPACE.Transactions, recordKey(record.hash))
      }
    }
  }

  async #readAll(): Promise<readonly ITransactionRecord[]> {
    const keys = await this.#storage.keys(STORAGE_NAMESPACE.Transactions)
    const records: ITransactionRecord[] = []

    for (const key of keys) {
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
