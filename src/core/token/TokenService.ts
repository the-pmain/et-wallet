import { areAddressesEqual, isValidAddress } from '@/core/address'
import {
  InvalidTokenContractError,
  NetworkNotFoundError,
  NotInitializedError,
  TokenNotFoundError,
  UnsupportedTokenStandardError,
} from '@/core/errors'
import { EventBus, type EventListener } from '@/core/events'
import { TRANSFER_TOPIC, addressToTopic } from '@/core/history'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { Address, ChainId, Timestamp, Unsubscribe, Wei } from '@/core/types'

import type { ITokenRepository, ITokenService } from './contracts'
import {
  BALANCE_OF_SELECTOR,
  DECIMALS_SELECTOR,
  NAME_SELECTOR,
  SYMBOL_SELECTOR,
  decodeString,
  decodeUint,
  encodeCall,
  encodeCallWithAddress,
} from './erc20'
import {
  TOKEN_STANDARD,
  type IAddTokenParams,
  type IToken,
  type ITokenMetadata,
  type ITokenRef,
  type TokenEventMap,
} from './types'

const SERVICE_NAME = 'TokenService'

/**
 * Предел числа десятичных знаков.
 *
 * Стандарт объявляет `decimals` как `uint8`, то есть до 255. Значение
 * выше 36 не встречается ни у одного действующего токена и почти
 * наверняка означает ошибку либо намеренную порчу: возведение десяти
 * в такую степень превращает любой баланс в неразличимый ноль.
 */
const MAX_DECIMALS = 36

/** Глубина поиска входящих переводов при обнаружении токенов. */
const DETECT_WINDOW_BLOCKS = 10_000n

/** Зависимости сервиса. */
export interface ITokenServiceDependencies {
  readonly repository: ITokenRepository
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Управление списком отслеживаемых токенов.
 *
 * МЕТАДАННЫЕ ЧИТАЮТСЯ ИЗ КОНТРАКТА, А НЕ ПРИНИМАЮТСЯ НА ВЕРУ. Число
 * десятичных знаков определяет порядок величины показанной суммы: токен
 * с шестью знаками, записанный как восемнадцатизначный, покажет одну
 * миллионную настоящего баланса. Пользователь, вводящий это значение
 * вручную, ошибётся; сайт, предлагающий его, может ошибиться намеренно.
 *
 * ПЕРЕОПРЕДЕЛЕНИЕ СИМВОЛА РАЗРЕШЕНО, ПЕРЕОПРЕДЕЛЕНИЕ ЗНАКОВ — НЕТ.
 * Символ — подпись на экране, и пользователь вправе назвать токен так,
 * как ему удобно. Число знаков — арифметика, и расхождение с контрактом
 * означает неверную сумму.
 *
 * ВСЕ ДОБАВЛЕННЫЕ ТОКЕНЫ ПОМЕЧАЮТСЯ НЕПРОВЕРЕННЫМИ. Встроенного списка
 * нет намеренно: вписать адреса известных токенов по памяти значит
 * рискнуть пометить мошеннический контракт как проверенный, а это
 * опаснее отсутствия пометки вовсе. Курируемый список требует сверки
 * с авторитетным источником.
 */
export class TokenService implements ITokenService {
  readonly #repository: ITokenRepository
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #events = new EventBus<TokenEventMap>({
    onListenerError: (error, event) => {
      this.#logger.error('Сбой обработчика события токенов', {
        event: String(event),
        error: error instanceof Error ? error.message : String(error),
      })
    },
  })

  /* Список держится в памяти: он нужен интерфейсу постоянно, а расшифровка
     хранилища на каждый рендер недопустима. */
  readonly #tokens = new Map<ChainId, readonly IToken[]>()

  #initialized = false

  constructor(dependencies: ITokenServiceDependencies) {
    this.#repository = dependencies.repository
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  async init(): Promise<void> {
    this.#tokens.clear()

    for (const network of this.#networks.list()) {
      this.#tokens.set(network.chainId, await this.#repository.findAll(network.chainId))
    }

    this.#initialized = true
  }

  /**
   * Отслеживаемые токены сети, включая нативную валюту.
   *
   * Нативная валюта синтезируется из конфигурации сети и всегда идёт
   * первой: она есть в любой сети и не может быть убрана. Единый список
   * избавляет интерфейс от двух разных путей показа одного и того же.
   */
  list(chainId: ChainId): readonly IToken[] {
    this.#assertInitialized()

    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      return []
    }

    const native: IToken = {
      chainId,
      address: null,
      standard: TOKEN_STANDARD.Native,
      symbol: network.nativeCurrency.symbol,
      name: network.nativeCurrency.name,
      decimals: network.nativeCurrency.decimals,
      logoUri: null,
      /* Нативная валюта — часть конфигурации сети, а не пользовательская
         добавка: помечать её как непроверенную было бы неверно. */
      isCustom: false,
      addedAt: 0 as Timestamp,
    }

    return [native, ...(this.#tokens.get(chainId) ?? [])]
  }

  get(ref: ITokenRef): IToken | null {
    return this.list(ref.chainId).find((token) => matches(token, ref)) ?? null
  }

  async add(params: IAddTokenParams): Promise<IToken> {
    this.#assertInitialized()

    const standard = params.standard ?? TOKEN_STANDARD.Erc20

    if (standard !== TOKEN_STANDARD.Erc20) {
      throw new UnsupportedTokenStandardError(standard)
    }

    if (!isValidAddress(params.address)) {
      throw new InvalidTokenContractError(params.address, 'значение не является адресом')
    }

    const metadata = await this.fetchMetadata(params.chainId, params.address)

    /* Число знаков из параметров сверяется, а не подставляется:
       расхождение с контрактом означает сумму, неверную на порядки,
       и молчаливо предпочесть чужое значение нельзя. */
    if (params.decimals !== undefined && params.decimals !== metadata.decimals) {
      throw new InvalidTokenContractError(
        params.address,
        `контракт сообщает ${String(metadata.decimals)} знаков, ` +
          `а указано ${String(params.decimals)}`,
      )
    }

    const override = params.symbol?.trim() ?? ''
    const token: IToken = {
      chainId: params.chainId,
      address: params.address,
      standard,
      symbol: override === '' ? metadata.symbol : override,
      name: metadata.name,
      decimals: metadata.decimals,
      logoUri: null,
      isCustom: true,
      addedAt: this.#clock.now(),
    }

    await this.#repository.save(token)

    this.#tokens.set(params.chainId, [
      ...(this.#tokens.get(params.chainId) ?? []).filter((item) => !matches(item, params)),
      token,
    ])

    this.#logger.info('Добавлен токен', { chainId: params.chainId })
    this.#events.emit('token:listChanged', { chainId: params.chainId })

    return token
  }

  async remove(ref: ITokenRef): Promise<void> {
    this.#assertInitialized()

    if (ref.address === null) {
      /* Нативная валюта не убирается: она есть в сети всегда, и её
         отсутствие в списке означало бы, что баланс сети неизвестен. */
      throw new UnsupportedTokenStandardError(TOKEN_STANDARD.Native)
    }

    const existing = this.#tokens.get(ref.chainId) ?? []

    if (!existing.some((item) => matches(item, ref))) {
      throw new TokenNotFoundError(ref.address)
    }

    await this.#repository.delete(ref)

    this.#tokens.set(
      ref.chainId,
      existing.filter((item) => !matches(item, ref)),
    )

    this.#events.emit('token:listChanged', { chainId: ref.chainId })
  }

  /**
   * Читает метаданные контракта без добавления в список.
   *
   * ЧИСЛО ЗНАКОВ ОБЯЗАТЕЛЬНО. Контракт, не отвечающий на `decimals()`,
   * отвергается: без этого значения любая показанная сумма — выдумка.
   * Символ и имя, напротив, объявлены стандартом необязательными,
   * и их отсутствие заменяется усечённым адресом — он хуже читается,
   * но не искажает ни одной величины.
   */
  async fetchMetadata(chainId: ChainId, address: Address): Promise<ITokenMetadata> {
    const provider = await this.#connect(chainId)

    return {
      decimals: await this.#readDecimals(provider, address),
      symbol: await this.#readText(provider, address, SYMBOL_SELECTOR, shortAddress(address)),
      name: await this.#readText(provider, address, NAME_SELECTOR, shortAddress(address)),
      standard: TOKEN_STANDARD.Erc20,
    }
  }

  async getBalance(ref: ITokenRef, owner: Address): Promise<Wei> {
    if (ref.address === null) {
      throw new UnsupportedTokenStandardError(TOKEN_STANDARD.Native)
    }

    const provider = await this.#connect(ref.chainId)
    const contract = ref.address

    try {
      return decodeUint(
        await provider.call({
          to: contract,
          data: encodeCallWithAddress(BALANCE_OF_SELECTOR, owner),
        }),
      ) as Wei
    } catch (error) {
      throw new InvalidTokenContractError(
        contract,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Обнаруживает токены, приходившие на адрес.
   *
   * НАЙДЕННОЕ НЕ ДОБАВЛЯЕТСЯ АВТОМАТИЧЕСКИ. Прислать на чужой адрес токен
   * с именем известного проекта может кто угодно и почти бесплатно.
   * Автодобавление превратило бы кошелёк в площадку показа мошеннических
   * названий, причём с видом одобрения: раз показано — значит, признано.
   *
   * ОГРАНИЧЕНИЕ ИСТОЧНИКА. Поиск идёт по журналам узла, а публичные узлы
   * часто отвергают выборку без указания контракта. Отказ доводится
   * до вызывающего кода, а не подменяется пустым списком: «токенов нет»
   * и «узнать не удалось» — разные утверждения.
   */
  async detect(chainId: ChainId, owner: Address): Promise<readonly ITokenMetadata[]> {
    const provider = await this.#connect(chainId)
    const found: ITokenMetadata[] = []

    for (const contract of await this.#findIncomingContracts(provider, owner)) {
      try {
        if ((await this.getBalance({ chainId, address: contract }, owner)) > 0n) {
          found.push(await this.fetchMetadata(chainId, contract))
        }
      } catch {
        /* Контракт, не отвечающий на стандартные вызовы, просто не токен
           ERC-20. Отказ одного не должен прерывать обход остальных. */
        continue
      }
    }

    return found
  }

  on<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.on(event, listener)
  }

  once<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): Unsubscribe {
    return this.#events.once(event, listener)
  }

  off<TName extends keyof TokenEventMap>(
    event: TName,
    listener: EventListener<TokenEventMap[TName]>,
  ): void {
    this.#events.off(event, listener)
  }

  /**
   * Читает число десятичных знаков.
   *
   * @throws InvalidTokenContractError если функции нет либо значение
   *         выходит за разумные пределы.
   */
  async #readDecimals(provider: IProvider, address: Address): Promise<number> {
    let raw: bigint

    try {
      raw = decodeUint(await provider.call({ to: address, data: encodeCall(DECIMALS_SELECTOR) }))
    } catch {
      throw new InvalidTokenContractError(address, 'контракт не сообщает число десятичных знаков')
    }

    const decimals = Number(raw)

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
      throw new InvalidTokenContractError(
        address,
        `недопустимое число десятичных знаков: ${raw.toString()}`,
      )
    }

    return decimals
  }

  /**
   * Читает текстовое поле, подставляя запасное значение при отказе.
   *
   * Символ и имя объявлены стандартом необязательными, и контракт вправе
   * их не реализовывать. Отказ добавить такой токен был бы чрезмерным.
   */
  async #readText(
    provider: IProvider,
    address: Address,
    functionSelector: string,
    fallback: string,
  ): Promise<string> {
    try {
      const text = decodeString(
        await provider.call({ to: address, data: encodeCall(functionSelector) }),
      )

      return text.trim() === '' ? fallback : text
    } catch {
      return fallback
    }
  }

  /** Контракты, присылавшие переводы на адрес. */
  async #findIncomingContracts(provider: IProvider, owner: Address): Promise<readonly Address[]> {
    const latest = await provider.getBlockNumber()
    const fromBlock = latest > DETECT_WINDOW_BLOCKS ? latest - DETECT_WINDOW_BLOCKS : 0n

    const logs = await provider.getLogs({
      fromBlock,
      toBlock: latest,
      topics: [TRANSFER_TOPIC, null, addressToTopic(owner)],
    })

    /* Повторы убираются по адресу в нижнем регистре: один контракт
       присылает десятки переводов, а метаданные у него одни. */
    const unique = new Map<string, Address>()

    for (const log of logs) {
      if (!log.removed) {
        unique.set(log.address.toLowerCase(), log.address)
      }
    }

    return [...unique.values()]
  }

  async #connect(chainId: ChainId): Promise<IProvider> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    return await this.#resolver.get(network)
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new NotInitializedError(SERVICE_NAME)
    }
  }
}

/** Совпадает ли токен со ссылкой. Нативная валюта опознаётся по `null`. */
function matches(token: IToken, ref: ITokenRef): boolean {
  if (ref.address === null || token.address === null) {
    return ref.address === null && token.address === null
  }

  return areAddressesEqual(token.address, ref.address)
}

/** Усечённый адрес как запасное имя токена. */
function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
