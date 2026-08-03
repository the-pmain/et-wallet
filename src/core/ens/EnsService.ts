import { areAddressesEqual } from '@/core/address'
import type { INetworkService } from '@/core/network'
import type { IClock, ILogger } from '@/core/platform'
import type { IProvider, IProviderResolver } from '@/core/provider'
import type { Address, ChainId, HexString, Timestamp } from '@/core/types'

import type { IEnsResolution, IEnsService } from './contracts'
import { beautifyEnsName, isAsciiEnsName, normalizeEnsName } from './ens-name'
import { namehash, reverseNode } from './namehash'
import {
  ENS_ADDR_SELECTOR,
  ENS_CHAIN_ID,
  ENS_REGISTRY_ADDRESS,
  ENS_NAME_SELECTOR,
  ENS_RESOLVER_SELECTOR,
  decodeAddressWord,
  decodeStringResult,
  encodeNodeCall,
} from './registry'

const SERVICE_NAME = 'EnsService'

/**
 * Срок жизни записи в кэше.
 *
 * Имена меняют владельцев: срок регистрации истекает, запись
 * переписывается. Пять минут — компромисс между «не спрашивать узел
 * на каждое нажатие клавиши» и «не показывать вчерашнего владельца».
 * Перед отправкой средств имя разрешается заново — на это кэш
 * не влияет, потому что подтверждение перевода идёт по адресу,
 * а не по имени.
 */
const CACHE_TTL_MS = 5 * 60 * 1000

/** Запись кэша. `value` равен `null`, если записи в ENS нет. */
interface ICacheEntry<TValue> {
  readonly value: TValue | null
  readonly at: Timestamp
}

/** Зависимости сервиса. */
export interface IEnsServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Разрешение имён ENS поверх активного соединения.
 *
 * РАБОТАЕТ ТОЛЬКО КОГДА АКТИВНА СЕТЬ ETHEREUM. Реестр ENS существует
 * в одной цепи, и разрешить имя из Polygon можно было бы, лишь открыв
 * второе соединение — с узлом Ethereum, которому при этом сообщается,
 * какое имя и с какого адреса ищет пользователь. Такой запрос уходил бы
 * незаметно для владельца, находящегося, как он считает, в другой сети.
 * Решение о втором операторе принимает он, а не умолчание в коде;
 * до появления такого выбора ENS доступен там, где он живёт.
 *
 * КЭШ ХРАНИТ И ОТРИЦАТЕЛЬНЫЕ ОТВЕТЫ. Поле ввода получателя обращается
 * к сервису на каждое нажатие клавиши, и недописанное имя — самый частый
 * запрос. Не запомнив «записи нет», кошелёк опрашивал бы узел десятки
 * раз за одно введённое имя.
 *
 * ОТКАЗЫ УЗЛА НЕ КЭШИРУЮТСЯ НИКОГДА: запомнить «неизвестно» на пять
 * минут значит превратить единичный сбой сети в пятиминутную поломку.
 */
export class EnsService implements IEnsService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #clock: IClock
  readonly #logger: ILogger

  readonly #forward = new Map<string, ICacheEntry<IEnsResolution>>()
  readonly #reverse = new Map<string, ICacheEntry<IEnsResolution>>()

  constructor(dependencies: IEnsServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  isSupported(chainId: ChainId): boolean {
    return chainId === ENS_CHAIN_ID
  }

  async resolveName(name: string): Promise<IEnsResolution | null> {
    const normalized = normalizeEnsName(name)

    if (normalized === null) {
      return null
    }

    const cached = EnsService.#read(this.#forward, normalized, this.#clock.now())

    if (cached !== undefined) {
      return cached
    }

    const provider = await this.#provider()

    if (provider === null) {
      return null
    }

    const node = namehash(normalized)
    const resolverAddress = await this.#resolverOf(provider, node)

    if (resolverAddress === null) {
      this.#remember(this.#forward, normalized, null)

      return null
    }

    const address = decodeAddressWord(
      await provider.call({ to: resolverAddress, data: encodeNodeCall(ENS_ADDR_SELECTOR, node) }),
    )

    if (address === null) {
      this.#remember(this.#forward, normalized, null)

      return null
    }

    const resolution: IEnsResolution = {
      name: normalized,
      displayName: beautifyEnsName(normalized),
      isAscii: isAsciiEnsName(normalized),
      address,
    }

    this.#remember(this.#forward, normalized, resolution)

    return resolution
  }

  async lookupAddress(address: Address): Promise<IEnsResolution | null> {
    const key = address.toLowerCase()
    const cached = EnsService.#read(this.#reverse, key, this.#clock.now())

    if (cached !== undefined) {
      return cached
    }

    const provider = await this.#provider()

    if (provider === null) {
      return null
    }

    const node = reverseNode(address)
    const resolverAddress = await this.#resolverOf(provider, node)

    if (resolverAddress === null) {
      this.#remember(this.#reverse, key, null)

      return null
    }

    const claimed = decodeStringResult(
      await provider.call({ to: resolverAddress, data: encodeNodeCall(ENS_NAME_SELECTOR, node) }),
    )

    const verified = claimed === null ? null : await this.#verify(address, claimed)

    this.#remember(this.#reverse, key, verified)

    return verified
  }

  clearCache(): void {
    this.#forward.clear()
    this.#reverse.clear()
  }

  /**
   * Подтверждает обратную запись прямым разрешением.
   *
   * САМАЯ ВАЖНАЯ ПРОВЕРКА ВО ВСЁМ МОДУЛЕ. Обратная запись задаётся
   * владельцем адреса и никем не проверяется: объявить своим именем
   * `binance.eth` вправе кто угодно. Единственное, что делает имя
   * осмысленным, — совпадение адреса, на который указывает само имя,
   * с адресом, у которого это имя спросили.
   *
   * Несовпадение записывается в журнал: это не сбой, а попытка выдать
   * себя за другого, и след от неё остаться должен.
   */
  async #verify(address: Address, claimed: string): Promise<IEnsResolution | null> {
    const normalized = normalizeEnsName(claimed)

    if (normalized === null) {
      /* Имя не прошло ENSIP-15: смешение письменностей, запрещённый
         символ либо метка `xn--`. Показать его непроверенным — значит
         показать ровно ту строку, которую подделывают. */
      this.#logger.warn('The ENS reverse record failed normalisation', {
        note: 'the name is not shown; the address is displayed instead',
      })

      return null
    }

    const forward = await this.resolveName(normalized)

    if (forward === null || !areAddressesEqual(forward.address, address)) {
      this.#logger.warn('The ENS reverse record was not confirmed by forward resolution', {
        note: 'the name is not shown: the owner of an address may claim any name',
      })

      return null
    }

    return forward
  }

  /** Адрес резолвера узла либо `null`, если узел не зарегистрирован. */
  async #resolverOf(provider: IProvider, node: HexString): Promise<Address | null> {
    return decodeAddressWord(
      await provider.call({
        to: ENS_REGISTRY_ADDRESS,
        data: encodeNodeCall(ENS_RESOLVER_SELECTOR, node),
      }),
    )
  }

  /**
   * Соединение с сетью, в которой живёт реестр.
   *
   * `null`, если активна другая сеть. Второе соединение здесь
   * не открывается — см. пояснение к классу.
   */
  async #provider(): Promise<IProvider | null> {
    const network = this.#networks.getActive()

    if (!this.isSupported(network.chainId)) {
      return null
    }

    return await this.#resolver.get(network)
  }

  /** Кладёт значение в кэш вместе со временем записи. */
  #remember<TValue>(
    cache: Map<string, ICacheEntry<TValue>>,
    key: string,
    value: TValue | null,
  ): void {
    cache.set(key, { value, at: this.#clock.now() })
  }

  /**
   * Читает кэш.
   *
   * @returns `undefined`, если записи нет либо она устарела; `null`,
   *          если запомнено отсутствие записи в ENS.
   */
  static #read<TValue>(
    cache: Map<string, ICacheEntry<TValue>>,
    key: string,
    now: Timestamp,
  ): TValue | null | undefined {
    const entry = cache.get(key)

    if (entry === undefined) {
      return undefined
    }

    if (now - entry.at > CACHE_TTL_MS) {
      cache.delete(key)

      return undefined
    }

    return entry.value
  }
}
