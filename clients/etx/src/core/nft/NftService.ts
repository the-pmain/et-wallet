import { decodeAddress, encodeCallWithAddressAndUint, encodeCallWithUint } from '@/core/abi'
import { areAddressesEqual } from '@/core/address'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  addressToTopic,
  splitDataWords,
} from '@/core/history'
import type { INetworkService } from '@/core/network'
import { NetworkNotFoundError } from '@/core/errors'
import type { ILogger } from '@/core/platform'
import type { ILogEntry, IProvider, IProviderResolver } from '@/core/provider'
import {
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  TOKEN_STANDARD,
  decodeString,
  encodeCall,
  type TokenStandard,
} from '@/core/token'
import type { Address, ChainId, HexString } from '@/core/types'

import { ERC1155_BALANCE_OF_SELECTOR, OWNER_OF_SELECTOR } from './abi'
import type { INftPage } from './types'

const SERVICE_NAME = 'NftService'

/**
 * Глубина выборки в блоках.
 *
 * То же значение, что у истории переводов: публичные узлы ограничивают
 * диапазон `eth_getLogs`, и десять тысяч блоков принимают почти все.
 * Больше просить бессмысленно — узел ответит отказом, и список окажется
 * пустым вместо короткого.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/**
 * Сколько предметов проверяется на принадлежность.
 *
 * Каждая проверка — отдельное обращение к контракту. У адреса, через
 * который прошли сотни предметов, полная проверка означала бы сотни
 * запросов: лимиты публичного узла исчерпаются, а пользователь будет
 * ждать минуты. Пропущенные считаются и показываются.
 */
const MAX_CHECKED_ITEMS = 60

/**
 * Сколько проверок выполняется одновременно.
 *
 * Последовательная проверка шестидесяти предметов заняла бы десятки
 * секунд, а все сразу — верный способ получить отказ по числу запросов
 * в секунду. Восемь — середина, принимаемая публичными узлами.
 */
const BATCH_SIZE = 8

/** Число тем у события ERC-721: идентификатор события плюс три параметра. */
const ERC721_TOPIC_COUNT = 4

/** Зависимости сервиса. */
export interface INftServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger
  readonly scanBlocks?: number
}

/** Итог выборки журналов вместе с числом отказов. */
interface IScanResult {
  readonly logs: readonly ILogEntry[]

  /** Сколько запросов узел отклонил. */
  readonly failed: number

  /** Сколько запросов было сделано всего. */
  readonly total: number

  /** Причина последнего отказа. `null`, если отказов не было. */
  readonly reason: string | null
}

/** Название и обозначение коллекции, прочитанные из контракта. */
interface ICollection {
  readonly name: string | null
  readonly symbol: string | null
}

/** Найденный предмет до проверки принадлежности. */
interface ICandidate {
  readonly contract: Address
  readonly tokenId: bigint
  readonly standard: TokenStandard
}

/**
 * Коллекционные токены, принадлежащие адресу.
 *
 * КАК ЭТО РАБОТАЕТ И ПОЧЕМУ ИНАЧЕ НЕЛЬЗЯ. Узел не умеет отвечать
 * на вопрос «что принадлежит адресу»: у него нет такого индекса.
 * Сервис находит поступления в журналах событий, а затем спрашивает
 * у каждого контракта, принадлежит ли предмет владельцу СЕЙЧАС.
 *
 * ДВА ШАГА ОБЯЗАТЕЛЬНЫ. Журнал — это история: предмет, полученный вчера
 * и отданный сегодня, останется в нём навсегда. Список, построенный
 * по одним журналам, показывал бы чужое имущество как своё.
 *
 * ЧЕГО СЕРВИС НЕ ДЕЛАЕТ. Он не загружает изображения и не обращается
 * по ссылкам из контрактов: адрес такой ссылки задаёт автор контракта,
 * и её загрузка раскрыла бы IP-адрес владельца произвольному серверу,
 * позволив связать его с кошельком.
 */
export class NftService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #scanBlocks: number

  /* Названия коллекций живут до конца сессии: они не меняются, а запрос
     их заново на каждое обновление списка удваивал бы число обращений
     к узлу. Ключ — сеть и адрес контракта: один адрес в разных сетях —
     разные коллекции.

     ХРАНИТСЯ ОБЕЩАНИЕ, А НЕ ГОТОВОЕ ЗНАЧЕНИЕ. Предметы одной коллекции
     проверяются одновременно, и кэш с результатом не успел бы
     заполниться: каждый спросил бы контракт заново. */
  readonly #collections = new Map<string, Promise<ICollection>>()

  constructor(dependencies: INftServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#scanBlocks = dependencies.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  /**
   * Возвращает предметы, принадлежащие владельцу.
   *
   * Отказ узла не выбрасывается наружу: список остаётся пустым,
   * а причина попадает в `limits`. Пустой список без объяснения
   * читается владельцем как пропажа имущества.
   */
  async list(owner: Address, chainId: ChainId): Promise<INftPage> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    let provider: IProvider
    let scan: IScanResult

    try {
      provider = await this.#resolver.get(network)

      const latest = await provider.getBlockNumber()
      const fromBlock = latest > BigInt(this.#scanBlocks) ? latest - BigInt(this.#scanBlocks) : 0n

      scan = await this.#fetchIncoming(provider, owner, fromBlock, latest)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The list of items is unavailable', { reason })

      return {
        items: [],
        limits: { scannedBlocks: null, sourceUnavailable: true, reason, skipped: 0 },
      }
    }

    /* Отказ по одному виду событий оставляет список неполным,
       но осмысленным; отказ по всем означает, что узел не ответил
       вовсе, и пустой список тогда ничего не утверждает. */
    if (scan.failed === scan.total) {
      return {
        items: [],
        limits: {
          scannedBlocks: null,
          sourceUnavailable: true,
          reason: scan.reason,
          skipped: 0,
        },
      }
    }

    const candidates = collectCandidates(scan.logs)
    const checked = candidates.slice(0, MAX_CHECKED_ITEMS)
    const items = await this.#keepOwned(provider, owner, chainId, checked)

    return {
      items,
      limits: {
        scannedBlocks: this.#scanBlocks,
        sourceUnavailable: false,
        reason: null,
        skipped: candidates.length - checked.length,
      },
    }
  }

  /** Забывает названия коллекций. Вызывается при закрытии сессии. */
  clear(): void {
    this.#collections.clear()
  }

  /**
   * Журналы поступлений владельцу.
   *
   * ТРИ ЗАПРОСА, А НЕ ОДИН. Позиция получателя в темах различается:
   * у ERC-721 это вторая индексированная величина, у ERC-1155 — третья.
   * Один запрос без фильтра по получателю вернул бы переводы всей сети.
   *
   * Отказ по одному виду событий не отменяет остальные: узел может
   * не осилить широкий запрос, но ответить на узкий.
   */
  async #fetchIncoming(
    provider: IProvider,
    owner: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<IScanResult> {
    const to = addressToTopic(owner)

    const queries: readonly (readonly (HexString | null)[])[] = [
      [TRANSFER_TOPIC, null, to],
      [TRANSFER_SINGLE_TOPIC, null, null, to],
      [TRANSFER_BATCH_TOPIC, null, null, to],
    ]

    let reason: string | null = null

    const results = await Promise.all(
      queries.map(async (topics) => {
        try {
          return await provider.getLogs({ fromBlock, toBlock, topics })
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error)

          this.#logger.warn('The node rejected the log query', { reason })

          return null
        }
      }),
    )

    return {
      logs: results.filter((entries) => entries !== null).flat(),
      failed: results.filter((entries) => entries === null).length,
      total: results.length,
      reason,
    }
  }

  /**
   * Оставляет предметы, принадлежащие владельцу сейчас.
   *
   * Отказ контракта означает «проверить не удалось» и предмет
   * отбрасывается: показать непроверенное как своё — то же, что
   * показать чужое.
   */
  async #keepOwned(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidates: readonly ICandidate[],
  ): Promise<readonly INftPage['items'][number][]> {
    const owned: INftPage['items'][number][] = []

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE)

      const checked = await Promise.all(
        batch.map(async (candidate) => {
          const balance = await this.#ownedAmount(provider, owner, candidate)

          if (balance === 0n) {
            return null
          }

          const collection = await this.#collection(provider, chainId, candidate.contract)

          return {
            chainId,
            contract: candidate.contract,
            tokenId: candidate.tokenId,
            standard: candidate.standard,
            balance,
            collectionName: collection.name,
            collectionSymbol: collection.symbol,
          }
        }),
      )

      owned.push(...checked.filter((item) => item !== null))
    }

    return owned
  }

  /** Сколько экземпляров предмета принадлежит владельцу. */
  async #ownedAmount(provider: IProvider, owner: Address, candidate: ICandidate): Promise<bigint> {
    try {
      if (candidate.standard === TOKEN_STANDARD.Erc721) {
        const holder = decodeAddress(
          await provider.call({
            to: candidate.contract,
            data: encodeCallWithUint(OWNER_OF_SELECTOR, candidate.tokenId),
          }),
        )

        /* Предмет неделим: он либо принадлежит владельцу целиком,
           либо не принадлежит вовсе. */
        return areAddressesEqual(holder, owner) ? 1n : 0n
      }

      const balance = await provider.call({
        to: candidate.contract,
        data: encodeCallWithAddressAndUint(ERC1155_BALANCE_OF_SELECTOR, owner, candidate.tokenId),
      })

      return balance === '0x' ? 0n : BigInt(balance)
    } catch (error) {
      /* Сожжённый предмет — самый частый случай: `ownerOf` для него
         отвечает откатом. Отличить его от недоступности узла нечем,
         и оба означают «показывать нельзя». */
      this.#logger.debug('Ownership of the item was not confirmed', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return 0n
    }
  }

  /** Название и обозначение коллекции. Читаются один раз на контракт. */
  #collection(provider: IProvider, chainId: ChainId, contract: Address): Promise<ICollection> {
    const key = `${chainId.toString()}:${contract.toLowerCase()}`
    const cached = this.#collections.get(key)

    if (cached !== undefined) {
      return cached
    }

    const pending = Promise.all([
      this.#readText(provider, contract, NAME_SELECTOR),
      this.#readText(provider, contract, SYMBOL_SELECTOR),
    ]).then(([name, symbol]) => ({ name, symbol }))

    this.#collections.set(key, pending)

    return pending
  }

  /**
   * Читает строковое поле контракта.
   *
   * `null` вместо выдуманного значения: ни `name`, ни `symbol`
   * не обязательны для ERC-721 и вовсе не предусмотрены ERC-1155.
   * Подставить сюда «Неизвестная коллекция» значило бы утверждать,
   * что контракт так ответил.
   */
  async #readText(
    provider: IProvider,
    contract: Address,
    selector: string,
  ): Promise<string | null> {
    try {
      return decodeString(await provider.call({ to: contract, data: encodeCall(selector) }))
    } catch {
      return null
    }
  }
}

/**
 * Собирает предметы из журналов, отбрасывая повторы.
 *
 * ВИД СОБЫТИЯ ОПРЕДЕЛЯЕТ СТАНДАРТ. У ERC-20 и ERC-721 общее событие
 * `Transfer`, и различаются они только числом индексированных
 * параметров: у ERC-721 номер предмета тоже индексирован, отчего тем
 * становится четыре. Считать переводы ERC-20 предметами значило бы
 * показать в галерее чужие деньги.
 */
function collectCandidates(logs: readonly ILogEntry[]): readonly ICandidate[] {
  const seen = new Map<string, ICandidate>()

  const remember = (contract: Address, tokenId: bigint, standard: TokenStandard): void => {
    const key = `${contract.toLowerCase()}:${tokenId.toString()}`

    if (!seen.has(key)) {
      seen.set(key, { contract, tokenId, standard })
    }
  }

  for (const log of logs) {
    const topic = log.topics[0]

    if (topic === TRANSFER_TOPIC) {
      const tokenIdTopic = log.topics[3]

      if (log.topics.length === ERC721_TOPIC_COUNT && tokenIdTopic !== undefined) {
        remember(log.address, BigInt(tokenIdTopic), TOKEN_STANDARD.Erc721)
      }

      continue
    }

    if (topic === TRANSFER_SINGLE_TOPIC) {
      /* Данные события: номер предмета и количество. Количество здесь
         не берётся — оно описывает тот перевод, а не остаток на момент
         запроса. */
      const tokenId = splitDataWords(log.data)[0]

      if (tokenId !== undefined) {
        remember(log.address, tokenId, TOKEN_STANDARD.Erc1155)
      }

      continue
    }

    if (topic === TRANSFER_BATCH_TOPIC) {
      for (const tokenId of decodeBatchIds(log.data)) {
        remember(log.address, tokenId, TOKEN_STANDARD.Erc1155)
      }
    }
  }

  return [...seen.values()]
}

/**
 * Читает номера предметов из события `TransferBatch`.
 *
 * Данные содержат два массива переменной длины: номера и количества.
 * Первое слово — смещение до первого массива, по нему лежит длина,
 * затем значения. Смещение читается, а не предполагается равным 64:
 * стандарт этого не гарантирует, и предположение молча дало бы чужие
 * числа.
 */
function decodeBatchIds(data: HexString): readonly bigint[] {
  const words = splitDataWords(data)
  const offsetWord = words[0]

  if (offsetWord === undefined) {
    return []
  }

  /* Смещение задано в байтах, а слово занимает 32 байта. */
  const start = Number(offsetWord) / 32
  const lengthWord = words[start]

  if (lengthWord === undefined) {
    return []
  }

  const length = Number(lengthWord)
  const ids: bigint[] = []

  for (let index = 0; index < length; index += 1) {
    const word = words[start + 1 + index]

    if (word === undefined) {
      break
    }

    ids.push(word)
  }

  return ids
}
