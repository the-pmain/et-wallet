import { NetworkNotFoundError } from '@/core/errors'
import { addressToTopic, topicToAddress } from '@/core/history'
import type { INetworkService } from '@/core/network'
import { decodeBool } from '@/core/nft'
import type { ILogger } from '@/core/platform'
import type { ILogEntry, IProvider, IProviderResolver } from '@/core/provider'
import {
  DECIMALS_SELECTOR,
  SYMBOL_SELECTOR,
  TOKEN_STANDARD,
  decodeString,
  decodeUint,
  encodeCall,
  type TokenStandard,
} from '@/core/token'
import type { Address, ChainId, HexString } from '@/core/types'

import {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  ERC20_APPROVAL_TOPIC_COUNT,
  IS_APPROVED_FOR_ALL_SELECTOR,
  encodeAllowance,
} from './abi'
import type { IApprovalPage, IApprovalRecord } from './types'

const SERVICE_NAME = 'ApprovalService'

/**
 * Глубина выборки в блоках.
 *
 * То же значение, что у истории и коллекционных токенов: публичные узлы
 * ограничивают диапазон `eth_getLogs`, и десять тысяч блоков принимают
 * почти все.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/**
 * Сколько разрешений проверяется на действительность.
 *
 * Каждая проверка — обращение к контракту. У активного адреса выдач
 * могут быть сотни; полная проверка исчерпала бы лимиты узла.
 */
const MAX_CHECKED_ITEMS = 60

/** Сколько проверок выполняется одновременно. */
const BATCH_SIZE = 8

/**
 * Порог, начиная с которого разрешение считается неограниченным.
 *
 * Приложения запрашивают либо `uint256` целиком, либо близкие к нему
 * значения вроде `2^255`. Сравнение на точное равенство пропустило бы
 * второе, а разница между «весь баланс» и «почти весь баланс»
 * для владельца отсутствует.
 */
const UNLIMITED_THRESHOLD = 1n << 200n

/** Зависимости сервиса. */
export interface IApprovalServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger
  readonly scanBlocks?: number
}

/** Найденная выдача до проверки действительности. */
interface ICandidate {
  readonly contract: Address
  readonly spender: Address
  readonly standard: TokenStandard
}

/** Итог выборки журналов вместе с числом отказов. */
interface IScanResult {
  readonly logs: readonly ILogEntry[]
  readonly failed: number
  readonly total: number
  readonly reason: string | null
}

/**
 * Разрешения, выданные адресом.
 *
 * КАК ЭТО РАБОТАЕТ. Узел не хранит списка «кому что разрешено»: сервис
 * находит события выдачи в журналах, а затем спрашивает у каждого
 * контракта, действует ли разрешение СЕЙЧАС — `allowance` для токенов,
 * `isApprovedForAll` для коллекций.
 *
 * ДВА ШАГА ОБЯЗАТЕЛЬНЫ. Журнал хранит историю: отозванное разрешение
 * остаётся в нём навсегда. Список по одним журналам пугал бы владельца
 * тем, чего давно нет, и обесценивал бы настоящие находки.
 *
 * СЕРВИС НИЧЕГО НЕ ОТЗЫВАЕТ. Отзыв — транзакция, которую подписывает
 * владелец; её готовит транзакционный слой. Здесь только чтение.
 */
export class ApprovalService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #scanBlocks: number

  /* Метаданные токенов живут до конца сессии: они не меняются.
     Хранится обещание, а не результат: проверки идут параллельно,
     и кэш с готовым значением не успел бы заполниться. */
  readonly #tokens = new Map<string, Promise<{ symbol: string | null; decimals: number | null }>>()

  constructor(dependencies: IApprovalServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#scanBlocks = dependencies.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  /**
   * Возвращает действующие разрешения владельца.
   *
   * Отказ узла не выбрасывается наружу: список остаётся пустым,
   * а причина попадает в `limits`. Пустой список без объяснения читается
   * как «вы никому ничего не разрешали» — утверждение, которого кошелёк
   * в этом случае делать не вправе.
   */
  async list(owner: Address, chainId: ChainId): Promise<IApprovalPage> {
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

      scan = await this.#fetchApprovals(provider, owner, fromBlock, latest)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('Список разрешений недоступен', { reason })

      return {
        items: [],
        limits: { scannedBlocks: null, sourceUnavailable: true, reason, skipped: 0 },
      }
    }

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
    const items = await this.#keepActive(provider, owner, chainId, checked)

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

  /** Забывает метаданные токенов. Вызывается при закрытии сессии. */
  clear(): void {
    this.#tokens.clear()
  }

  /**
   * Журналы выдач, где владелец — заданный адрес.
   *
   * ДВА ЗАПРОСА, потому что события разные: у токенов `Approval`,
   * у коллекций `ApprovalForAll`. Владелец в обоих индексирован первым.
   */
  async #fetchApprovals(
    provider: IProvider,
    owner: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<IScanResult> {
    const ownerTopic = addressToTopic(owner)

    const queries: readonly (readonly (HexString | null)[])[] = [
      [APPROVAL_TOPIC, ownerTopic],
      [APPROVAL_FOR_ALL_TOPIC, ownerTopic],
    ]

    let reason: string | null = null

    const results = await Promise.all(
      queries.map(async (topics) => {
        try {
          return await provider.getLogs({ fromBlock, toBlock, topics })
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error)

          this.#logger.warn('Выборка журналов отклонена узлом', { reason })

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

  /** Оставляет разрешения, действующие сейчас. */
  async #keepActive(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidates: readonly ICandidate[],
  ): Promise<readonly IApprovalRecord[]> {
    const active: IApprovalRecord[] = []

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE)

      const checked = await Promise.all(
        batch.map(async (candidate) => await this.#toRecord(provider, owner, chainId, candidate)),
      )

      active.push(...checked.filter((record) => record !== null))
    }

    return active
  }

  /**
   * Превращает найденную выдачу в запись, если она ещё действует.
   *
   * Отказ контракта означает «проверить не удалось», и запись
   * отбрасывается: показать непроверенное как действующее — то же,
   * что выдумать его.
   */
  async #toRecord(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidate: ICandidate,
  ): Promise<IApprovalRecord | null> {
    try {
      if (candidate.standard === TOKEN_STANDARD.Erc20) {
        const amount = decodeUint(
          await provider.call({
            to: candidate.contract,
            data: encodeAllowance(ALLOWANCE_SELECTOR, owner, candidate.spender),
          }),
        )

        /* Ноль означает, что разрешение отозвано либо израсходовано:
           показывать его как действующее нельзя. */
        if (amount === 0n) {
          return null
        }

        const token = await this.#token(provider, chainId, candidate.contract)

        return {
          chainId,
          contract: candidate.contract,
          spender: candidate.spender,
          standard: TOKEN_STANDARD.Erc20,
          amount,
          isUnlimited: amount >= UNLIMITED_THRESHOLD,
          symbol: token.symbol,
          decimals: token.decimals,
        }
      }

      const isApproved = decodeBool(
        await provider.call({
          to: candidate.contract,
          data: encodeAllowance(IS_APPROVED_FOR_ALL_SELECTOR, owner, candidate.spender),
        }),
      )

      if (!isApproved) {
        return null
      }

      const token = await this.#token(provider, chainId, candidate.contract)

      return {
        chainId,
        contract: candidate.contract,
        spender: candidate.spender,
        standard: TOKEN_STANDARD.Erc721,
        /* У разрешения на коллекцию количества нет: распоряжаться можно
           всеми предметами, включая те, которых ещё нет. */
        amount: null,
        isUnlimited: true,
        symbol: token.symbol,
        decimals: null,
      }
    } catch (error) {
      this.#logger.debug('Разрешение проверить не удалось', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return null
    }
  }

  /** Символ и число знаков контракта. Читаются один раз на адрес. */
  #token(
    provider: IProvider,
    chainId: ChainId,
    contract: Address,
  ): Promise<{ symbol: string | null; decimals: number | null }> {
    const key = `${chainId.toString()}:${contract.toLowerCase()}`
    const cached = this.#tokens.get(key)

    if (cached !== undefined) {
      return cached
    }

    const pending = Promise.all([
      readText(provider, contract, SYMBOL_SELECTOR),
      readDecimals(provider, contract),
    ]).then(([symbol, decimals]) => ({ symbol, decimals }))

    this.#tokens.set(key, pending)

    return pending
  }
}

/**
 * Собирает выдачи из журналов, оставляя по одной на пару
 * «контракт + получатель разрешения».
 *
 * ПОСЛЕДНЯЯ ВЫДАЧА ОТМЕНЯЕТ ПРЕДЫДУЩИЕ: разрешение перезаписывается,
 * а не складывается. Действующее значение всё равно читается
 * из контракта, поэтому здесь важно лишь не проверять одну и ту же пару
 * дважды.
 *
 * СОБЫТИЕ `Approval` С ЧЕТЫРЬМЯ ТЕМАМИ — ЭТО ERC-721: там индексирован
 * ещё и номер предмета. Разрешение на один предмет исчезает при первой
 * же передаче и в списке не нужно; включить его значило бы показывать
 * владельцу давно неактуальные записи.
 */
function collectCandidates(logs: readonly ILogEntry[]): readonly ICandidate[] {
  const seen = new Map<string, ICandidate>()

  for (const log of logs) {
    const topic = log.topics[0]
    const spenderTopic = log.topics[2]

    if (spenderTopic === undefined) {
      continue
    }

    const standard =
      topic === APPROVAL_TOPIC && log.topics.length === ERC20_APPROVAL_TOPIC_COUNT
        ? TOKEN_STANDARD.Erc20
        : topic === APPROVAL_FOR_ALL_TOPIC
          ? TOKEN_STANDARD.Erc721
          : null

    if (standard === null) {
      continue
    }

    let spender: Address

    try {
      spender = topicToAddress(spenderTopic)
    } catch {
      continue
    }

    const key = `${log.address.toLowerCase()}:${spender.toLowerCase()}:${standard}`

    if (!seen.has(key)) {
      seen.set(key, { contract: log.address, spender, standard })
    }
  }

  return [...seen.values()]
}

/**
 * Читает строковое поле контракта.
 *
 * `null` вместо выдуманного значения: символ не обязателен, а подставить
 * сюда «Неизвестный токен» значило бы утверждать, что контракт так
 * ответил.
 */
async function readText(
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

/**
 * Читает число знаков.
 *
 * `null` означает «неизвестно»: показать разрешение на 1000000 единиц
 * как «1 000 000 токенов» при шести знаках — ошибка на шесть порядков
 * в вопросе, где важна величина риска.
 */
async function readDecimals(provider: IProvider, contract: Address): Promise<number | null> {
  try {
    return Number(
      decodeUint(await provider.call({ to: contract, data: encodeCall(DECIMALS_SELECTOR) })),
    )
  } catch {
    return null
  }
}
