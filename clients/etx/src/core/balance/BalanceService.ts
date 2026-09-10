import { EventBus, type EventListener } from '@/core/events'
import { NetworkNotFoundError, NotImplementedError } from '@/core/errors'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProviderResolver } from '@/core/provider'
import type { ITokenRef, ITokenService } from '@/core/token'
import type { Address, ChainId, Timestamp, Unsubscribe, Wei } from '@/core/types'
import { mapWithLimit } from '@/shared/lib/concurrency'

import type { IBalanceService } from './contracts'
import type { BalanceEventMap, IAccountBalances, IBalance } from './types'

const SERVICE_NAME = 'BalanceService'

/**
 * Сколько балансов токенов запрашивается одновременно.
 *
 * Четыре — значение, при котором обычный кошелёк с пятью-десятью
 * токенами обновляется за две-три задержки сети вместо десяти, а узел
 * не начинает отвечать отказом по превышению частоты.
 */
const TOKEN_BALANCE_CONCURRENCY = 4

/**
 * Сколько значение считается свежим.
 *
 * Блок в сетях EVM выходит за секунды, но опрос узла с той же частотой
 * бессмыслен: баланс меняется только от операций пользователя и входящих
 * переводов. Пятнадцать секунд — компромисс между заметностью изменения
 * и нагрузкой на публичный узел.
 */
const DEFAULT_FRESHNESS_MS = 15_000

/**
 * Период фонового опроса при активной подписке.
 *
 * Заметно больше срока свежести: подписка нужна, чтобы значение обновлялось
 * само, а не чтобы держать его максимально точным. Более частый опрос
 * публичного узла раскрывает активность пользователя и упирается в лимиты.
 */
const DEFAULT_POLL_INTERVAL_MS = 30_000

/** Ссылка на нативную валюту сети: контракта у неё нет. */
function nativeTokenRef(chainId: ChainId): ITokenRef {
  return { chainId, address: null }
}

/** Настройки сервиса. */
export interface IBalanceServiceOptions {
  readonly freshnessMs?: number
  readonly pollIntervalMs?: number
}

/** Зависимости сервиса. */
export interface IBalanceServiceDependencies {
  /* Узкий контракт «дай соединение», а не конкретный кэш: сервису
     безразлично, кто и как обеспечивает переиспользование соединений,
     и зависимость от класса мешала бы заменить `ProviderPool`
     на `RpcManager` с переключением на резервный узел. */
  readonly providers: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger

  /**
   * Сервис токенов.
   *
   * Необязателен: балансом нативной валюты сервис занимается сам.
   * Без него запрос баланса токена завершается отказом, а не нулём —
   * ноль означал бы утверждение «токенов нет».
   */
  readonly tokens?: ITokenService

  readonly options?: IBalanceServiceOptions
}

/** Запись кэша. */
interface ICacheEntry {
  readonly raw: Wei
  readonly updatedAt: Timestamp
}

/** Активная подписка на обновление. */
interface ISubscription {
  count: number
  cancel: Unsubscribe
}

/**
 * Балансы нативной валюты с кэшированием и фоновым обновлением.
 *
 * ОБЪЁМ РЕАЛИЗАЦИИ. Нативная валюта читается и кэшируется здесь, балансы
 * токенов — через `ITokenService`, который умеет обращаться к контрактам.
 * Кэшируется пока только нативный баланс: список токенов меняется реже,
 * но его значения запрашиваются заново при каждом обновлении.
 *
 * `getToken` НЕ ВОЗВРАЩАЕТ НОЛЬ ПРИ ОТКАЗЕ. Нулевой баланс — это
 * утверждение «токенов нет», и пользователь, увидевший его вместо
 * отказа, решит, что средства пропали. Недоступность обязана выглядеть
 * как недоступность.
 *
 * УСТАРЕВШЕЕ ЗНАЧЕНИЕ ОТДАЁТСЯ, НО ПОМЕЧАЕТСЯ. Флаг `isStale` не украшение:
 * решение об отправке средств по сохранённому значению приводит к отказу
 * сети. Интерфейс обязан показывать признак устаревания.
 */
export class BalanceService implements IBalanceService {
  readonly #providers: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger
  readonly #tokens: ITokenService | null
  readonly #freshnessMs: number
  readonly #pollIntervalMs: number

  readonly #events = new EventBus<BalanceEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Balance event listener failed', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  readonly #cache = new Map<string, ICacheEntry>()
  readonly #subscriptions = new Map<string, ISubscription>()

  /* Незавершённые запросы к узлу. Два экрана, запросившие один баланс
     одновременно, разделяют один сетевой вызов. */
  readonly #inFlight = new Map<string, Promise<Wei>>()

  constructor(dependencies: IBalanceServiceDependencies) {
    this.#providers = dependencies.providers
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#tokens = dependencies.tokens ?? null
    this.#freshnessMs = dependencies.options?.freshnessMs ?? DEFAULT_FRESHNESS_MS
    this.#pollIntervalMs = dependencies.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  async getNative(owner: Address, chainId: ChainId): Promise<IBalance> {
    const cached = this.#cache.get(cacheKey(owner, chainId))

    if (cached !== undefined && this.#isFresh(cached)) {
      return this.#toBalance(owner, chainId, cached, false)
    }

    if (cached !== undefined) {
      /* Устаревшее значение отдаётся немедленно, обновление идёт фоном.
         Пустой экран вместо прежнего баланса выглядит как потеря средств. */
      void this.#refreshInBackground(owner, chainId)

      return this.#toBalance(owner, chainId, cached, true)
    }

    return this.#toBalance(owner, chainId, await this.#fetch(owner, chainId), false)
  }

  /**
   * Баланс токена.
   *
   * @throws NotImplementedError если сервис токенов не подключён:
   *         возврат нуля означал бы утверждение «токенов нет», которое
   *         кошелёк в этом состоянии проверить не может.
   */
  async getToken(owner: Address, token: ITokenRef): Promise<IBalance> {
    if (token.address === null) {
      return await this.getNative(owner, token.chainId)
    }

    if (this.#tokens === null) {
      throw new NotImplementedError(`${SERVICE_NAME}.getToken`)
    }

    const known = this.#tokens.get(token)

    return {
      owner,
      chainId: token.chainId,
      token,
      raw: await this.#tokens.getBalance(token, owner),
      /* Число знаков берётся из прочитанных метаданных. Отсутствие
         токена в списке означает, что читать неоткуда: подставить
         привычные восемнадцать значило бы исказить сумму на порядки. */
      decimals:
        known?.decimals ??
        (await this.#tokens.fetchMetadata(token.chainId, token.address)).decimals,
      updatedAt: this.#clock.now(),
      isStale: false,
    }
  }

  /**
   * Все балансы адреса в сети: нативная валюта и отслеживаемые токены.
   *
   * Отказ по одному токену не отменяет остальных: контракт мог быть
   * удалён либо перестать отвечать, и потерять из-за него весь список
   * хуже, чем показать неполный.
   */
  async getAll(owner: Address, chainId: ChainId): Promise<IAccountBalances> {
    const native = await this.getNative(owner, chainId)

    return {
      owner,
      chainId,
      native,
      tokens: await this.#loadTokenBalances(owner, chainId),
      updatedAt: native.updatedAt,
    }
  }

  async refresh(owner: Address, chainId: ChainId): Promise<IAccountBalances> {
    const entry = await this.#fetch(owner, chainId)
    const native = this.#toBalance(owner, chainId, entry, false)

    return {
      owner,
      chainId,
      native,
      tokens: await this.#loadTokenBalances(owner, chainId),
      updatedAt: native.updatedAt,
    }
  }

  /**
   * Балансы отслеживаемых токенов.
   *
   * ПАРАЛЛЕЛЬНОСТЬ ОГРАНИЧЕНА, А НЕ СНЯТА. Раньше запросы шли строго
   * по одному: десять токенов означали десять задержек сети подряд.
   * `Promise.all` — другая крайность: публичные узлы ограничивают
   * частоту обращений и отвечают отказом вместо баланса, а десяток
   * одновременных вызовов ещё и выдаёт наблюдателю весь состав портфеля
   * одним пакетом.
   *
   * Пакетный вызов через multicall быстрее любого из вариантов,
   * но требует доверия к отдельному контракту — это отдельное решение.
   *
   * ОТКАЗ ПО ОДНОМУ ТОКЕНУ НЕ УБИРАЕТ С ЭКРАНА ОСТАЛЬНЫЕ: недоступный
   * контракт не имеет права стереть балансы прочих токенов.
   */
  async #loadTokenBalances(owner: Address, chainId: ChainId): Promise<readonly IBalance[]> {
    const tokens = this.#tokens

    if (tokens === null) {
      return []
    }

    const tracked = tokens.list(chainId).filter((token) => token.address !== null)

    const settled = await mapWithLimit(
      tracked.map((token) => async () => await tokens.getBalance(token, owner)),
      TOKEN_BALANCE_CONCURRENCY,
    )

    const balances: IBalance[] = []

    tracked.forEach((token, index) => {
      const result = settled[index]

      if (result === undefined || token.address === null) {
        return
      }

      if (result.status === 'rejected') {
        this.#logger.warn('Token balance is unavailable', {
          chainId,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })

        return
      }

      balances.push({
        owner,
        chainId,
        token: { chainId, address: token.address },
        raw: result.value,
        decimals: token.decimals,
        updatedAt: this.#clock.now(),
        isStale: false,
      })
    })

    return balances
  }

  subscribe(owner: Address, chainId: ChainId): Unsubscribe {
    const key = cacheKey(owner, chainId)
    const existing = this.#subscriptions.get(key)

    if (existing !== undefined) {
      /* Подсчёт подписчиков, а не отдельный таймер на каждого: три виджета
         на одном экране опрашивали бы узел втрое чаще. */
      existing.count += 1

      return () => {
        this.#unsubscribe(key)
      }
    }

    const cancel = this.#clock.setInterval(() => {
      void this.#refreshInBackground(owner, chainId)
    }, this.#pollIntervalMs)

    this.#subscriptions.set(key, { count: 1, cancel })

    return () => {
      this.#unsubscribe(key)
    }
  }

  invalidate(owner?: Address, chainId?: ChainId): void {
    if (owner === undefined && chainId === undefined) {
      this.#cache.clear()

      return
    }

    for (const key of [...this.#cache.keys()]) {
      if (matchesKey(key, owner, chainId)) {
        this.#cache.delete(key)
      }
    }
  }

  on<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof BalanceEventMap>(
    event: TName,
    listener: EventListener<BalanceEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /** Останавливает все опросы. Вызывается при блокировке кошелька. */
  stop(): void {
    for (const subscription of this.#subscriptions.values()) {
      subscription.cancel()
    }

    this.#subscriptions.clear()
    this.#cache.clear()
  }

  #unsubscribe(key: string): void {
    const subscription = this.#subscriptions.get(key)

    if (subscription === undefined) {
      return
    }

    subscription.count -= 1

    if (subscription.count > 0) {
      return
    }

    subscription.cancel()
    this.#subscriptions.delete(key)
  }

  /** Запрашивает баланс у узла и обновляет кэш. */
  async #fetch(owner: Address, chainId: ChainId): Promise<ICacheEntry> {
    const key = cacheKey(owner, chainId)
    const pending = this.#inFlight.get(key)

    if (pending !== undefined) {
      return { raw: await pending, updatedAt: this.#clock.now() }
    }

    const request = this.#requestBalance(owner, chainId)

    this.#inFlight.set(key, request)

    try {
      const entry: ICacheEntry = { raw: await request, updatedAt: this.#clock.now() }

      this.#cache.set(key, entry)
      this.#events.emit('balance:updated', {
        owner,
        chainId,
        token: nativeTokenRef(chainId),
      })

      return entry
    } finally {
      this.#inFlight.delete(key)
    }
  }

  async #requestBalance(owner: Address, chainId: ChainId): Promise<Wei> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    const provider = await this.#providers.get(network)

    return await provider.getBalance(owner)
  }

  /**
   * Обновляет баланс, не выбрасывая исключение наружу.
   *
   * Фоновое обновление запускается без ожидания результата. Необработанное
   * отклонение здесь дошло бы до глобального обработчика и в service worker
   * manifest v3 выглядело бы как отказ всего расширения.
   */
  async #refreshInBackground(owner: Address, chainId: ChainId): Promise<void> {
    try {
      await this.#fetch(owner, chainId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The balance could not be refreshed', { chainId, reason })
      this.#events.emit('balance:refreshFailed', { owner, chainId, reason })
    }
  }

  #isFresh(entry: ICacheEntry): boolean {
    return this.#clock.now() - entry.updatedAt < this.#freshnessMs
  }

  #toBalance(owner: Address, chainId: ChainId, entry: ICacheEntry, isStale: boolean): IBalance {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return {
      owner,
      chainId,
      token: nativeTokenRef(chainId),
      raw: entry.raw,
      decimals: network.nativeCurrency.decimals,
      updatedAt: entry.updatedAt,
      isStale,
    }
  }
}

function cacheKey(owner: Address, chainId: ChainId): string {
  /* Адрес приводится к нижнему регистру: один и тот же адрес приходит
     и в контрольной сумме EIP-55, и в нижнем регистре из ответов RPC,
     и два написания дали бы две записи кэша с расходящимися значениями. */
  return `${owner.toLowerCase()}:${String(chainId)}`
}

function matchesKey(key: string, owner?: Address, chainId?: ChainId): boolean {
  const [keyOwner = '', keyChain = ''] = key.split(':')

  if (owner !== undefined && keyOwner !== owner.toLowerCase()) {
    return false
  }

  return chainId === undefined || keyChain === String(chainId)
}
