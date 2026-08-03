import { areAddressesEqual } from '@/core/address'
import type { INetworkService } from '@/core/network'
import { NetworkNotFoundError } from '@/core/errors'
import type { ILogger } from '@/core/platform'
import type { IProviderResolver } from '@/core/provider'
import { decodeTransfer } from '@/core/token'
import type { ITransactionRecord, ITransactionRepository } from '@/core/transaction'
import { toWei, type Address, type ChainId, type TxHash, type Wei } from '@/core/types'

import type { IHistoryProvider, IHistoryQuery } from './contracts'
import {
  TRANSFER_DIRECTION,
  TRANSFER_KIND,
  TRANSFER_SOURCE,
  type IHistoryCursor,
  type IHistoryPage,
  type ITransferRecord,
  type TransferKind,
} from './types'

const SERVICE_NAME = 'HistoryService'

/** Сколько записей запрашивается по умолчанию. */
const DEFAULT_LIMIT = 50

/** Уточнения запроса истории. */
export interface IHistoryOptions {
  readonly limit?: number

  /**
   * Продолжение предыдущей выдачи.
   *
   * Отсутствие означает первую страницу — с самых свежих записей.
   */
  readonly cursor?: IHistoryCursor | null
}

/** Зависимости сервиса. */
export interface IHistoryServiceDependencies {
  /**
   * Источники истории в порядке предпочтения.
   *
   * Первый обслуживающий сеть и ответивший без отказа определяет результат.
   * Порядок задаётся снаружи: он выражает выбор между полнотой
   * и приватностью, а это политика приложения, а не свойство механизма.
   */
  readonly providers: readonly IHistoryProvider[]

  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger

  /** Локальные отправки. Подмешиваются всегда. */
  readonly localRepository: ITransactionRepository
}

/**
 * Сводная история переводов.
 *
 * ЛОКАЛЬНЫЕ ЗАПИСИ ПОДМЕШИВАЮТСЯ ВСЕГДА. Отправленная транзакция попадает
 * в локальное хранилище сразу, а во внешний источник — после включения
 * в блок и переиндексации. Без локальных записей пользователь, отправивший
 * средства, не увидел бы их в истории несколько минут и решил, что
 * отправка не состоялась.
 *
 * ПОВТОРЫ УБИРАЮТСЯ ПО ХЭШУ. Когда внешний источник наконец отдаёт ту же
 * транзакцию, локальная запись уступает ей место: у внешней есть номер
 * блока, время и подтверждённое состояние.
 */
export class HistoryService {
  readonly #providers: readonly IHistoryProvider[]
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #local: ITransactionRepository

  constructor(dependencies: IHistoryServiceDependencies) {
    this.#providers = dependencies.providers
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#local = dependencies.localRepository
  }

  /**
   * История переводов адреса в сети.
   *
   * Отказ внешнего источника не приводит к отказу всей операции:
   * локальные записи возвращаются в любом случае. Пустая история
   * из-за недоступной сети выглядела бы как отсутствие операций.
   */
  async getHistory(
    owner: Address,
    chainId: ChainId,
    options: IHistoryOptions = {},
  ): Promise<IHistoryPage> {
    const limit = options.limit ?? DEFAULT_LIMIT
    const cursor = options.cursor ?? null

    /* СОБСТВЕННЫЕ ОТПРАВКИ ПОДМЕШИВАЮТСЯ ТОЛЬКО К ПЕРВОЙ СТРАНИЦЕ.
       Они не принадлежат ни одному участку истории и хранятся целиком
       у нас; повтори их каждая страница — ожидающая отправка
       появлялась бы в списке заново после каждого «показать более
       ранние». */
    const local = cursor === null ? await this.#loadLocal(owner, chainId) : []
    const remote = await this.#loadRemote({ owner, chainId, limit, cursor })

    if (remote.page === null) {
      return {
        transfers: local.slice(0, limit),
        limits: {
          nativeTransfersUnavailable: false,
          scannedBlocks: null,
          /* Ни один внешний источник не ответил. Показаны только
             собственные отправки, и это обязано быть сказано прямо:
             иначе пустой список читается как «операций не было». */
          sourceUnavailable: true,
          reason: remote.reason,
        },
        /* Метка возвращается неизменной: отказ источника не означает,
           что продолжения нет, и повторная попытка обязана начинаться
           с того же места. */
        cursor,
      }
    }

    return {
      transfers: merge(local, remote.page.transfers).slice(0, limit),
      limits: remote.page.limits,
      cursor: remote.page.cursor,
    }
  }

  /** Локальные отправки, приведённые к общему виду записи истории. */
  async #loadLocal(owner: Address, chainId: ChainId): Promise<readonly ITransferRecord[]> {
    const records = await this.#local.findByAddress(owner, chainId)

    return records.map((record) => {
      const transfer = describeLocal(record)

      return {
        /* Ключ строится так же, как у внешних источников: хэш плюс
           порядковый номер. Локальная запись описывает транзакцию целиком,
           поэтому номер нулевой. */
        id: `${record.hash}:local`,
        hash: record.hash,
        chainId: record.chainId,
        kind: transfer.kind,
        direction: TRANSFER_DIRECTION.Outgoing,
        from: record.from,
        to: transfer.to,
        value: transfer.value,
        tokenId: null,
        asset: { contract: transfer.contract, symbol: null, decimals: null },
        blockNumber: record.blockNumber ?? 0n,
        timestamp: record.confirmedAt ?? record.submittedAt,
        source: TRANSFER_SOURCE.Local,
        /* Состояние берётся из записи транзакции: именно оно
           отличает ожидание от выполнения, отката и замещения. */
        status: record.status,
      }
    })
  }

  /**
   * Первый источник, обслуживающий сеть и ответивший без отказа.
   *
   * Причина отказа последнего источника возвращается вместе с
   * результатом: она показывается пользователю дословно. Обобщённое
   * «история недоступна» не сказало бы ему, что делать, а сообщение
   * узла «укажите адрес контракта» прямо указывает на решение —
   * подключить свой узел либо индексатор.
   */
  async #loadRemote(
    query: IHistoryQuery,
  ): Promise<{ page: IHistoryPage | null; reason: string | null }> {
    const network = this.#networks.getByChainId(query.chainId)

    if (network === null) {
      throw new NetworkNotFoundError(query.chainId)
    }

    let lastReason: string | null = null

    for (const provider of this.#providers) {
      if (!provider.supports(query.chainId)) {
        continue
      }

      /* ПРОДОЛЖЕНИЕ ОБСЛУЖИВАЕТ ТОЛЬКО ВЫДАВШИЙ МЕТКУ ИСТОЧНИК.
         Перейди мы на следующий, он истолковал бы чужую метку как
         начало выдачи и вернул бы самые свежие записи под видом более
         ранних: список продолжился бы тем, что уже показан, и человек
         решил бы, что дальше истории нет. */
      const cursor = query.cursor ?? null

      if (cursor !== null && cursor.providerId !== provider.id) {
        continue
      }

      try {
        return {
          page: await provider.fetch(query, await this.#resolver.get(network)),
          reason: null,
        }
      } catch (error) {
        /* Отказ одного источника — повод перейти к следующему, а не
           лишить пользователя истории. Причина уходит и в журнал,
           и наружу: молчаливый переход скрыл бы неработающий ключ
           индексатора либо узел, не принимающий выборку журналов. */
        lastReason = error instanceof Error ? error.message : String(error)

        this.#logger.warn('The history source is unavailable', {
          providerId: provider.id,
          reason: lastReason,
        })
      }
    }

    return { page: null, reason: lastReason }
  }
}

/**
 * Объединяет локальные и внешние записи.
 *
 * Локальная запись отбрасывается, если тот же хэш пришёл извне: внешняя
 * содержит номер блока, время и подтверждённое состояние, локальная —
 * только намерение отправить.
 */
function merge(
  local: readonly ITransferRecord[],
  remote: readonly ITransferRecord[],
): readonly ITransferRecord[] {
  const remoteHashes = new Set<TxHash>(remote.map((record) => record.hash))
  const pendingLocal = local.filter((record) => !remoteHashes.has(record.hash))

  return [...remote, ...pendingLocal].sort(compareByRecency)
}

/**
 * Сортировка от новых к старым.
 *
 * Записи без номера блока — ещё не включённые в блок отправки — идут
 * первыми: именно их пользователь ждёт и ищет глазами.
 */
function compareByRecency(left: ITransferRecord, right: ITransferRecord): number {
  if (left.blockNumber === 0n && right.blockNumber !== 0n) {
    return -1
  }

  if (right.blockNumber === 0n && left.blockNumber !== 0n) {
    return 1
  }

  if (left.blockNumber !== right.blockNumber) {
    return Number(right.blockNumber - left.blockNumber)
  }

  return (right.timestamp ?? 0) - (left.timestamp ?? 0)
}

/** Совпадает ли адрес с владельцем истории. Вынесено для читаемости условий. */
export function isOwner(candidate: Address | null, owner: Address): boolean {
  return candidate !== null && areAddressesEqual(candidate, owner)
}

/**
 * Что именно перевела собственная транзакция.
 *
 * ЧИТАЕТСЯ ИЗ ПОДПИСАННЫХ ДАННЫХ, А НЕ ИЗ НАМЕРЕНИЯ. У перевода токена
 * поле `to` указывает на контракт, сумма нативной валюты нулевая,
 * а настоящий получатель и количество лежат в данных вызова. Показать
 * такую запись по полям транзакции значило бы сообщить пользователю
 * о переводе нуля неизвестно кому.
 *
 * Разбор данных, а не отдельное поле в записи, выбран сознательно:
 * так в историю попадает ровно то, что ушло в сеть. Разойдись форма
 * с подписью — запись покажет действительное содержимое.
 */
function describeLocal(record: ITransactionRecord): {
  readonly kind: TransferKind
  readonly to: Address | null
  readonly value: Wei
  readonly contract: Address | null
} {
  const call = record.data === null ? null : decodeTransfer(record.data)

  if (call === null || record.to === null) {
    return { kind: TRANSFER_KIND.Native, to: record.to, value: record.value, contract: null }
  }

  return {
    kind: TRANSFER_KIND.Erc20,
    to: call.to,
    value: toWei(call.amount),
    /* Адресат транзакции и есть контракт токена. */
    contract: record.to,
  }
}
