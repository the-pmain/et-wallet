import type { IEventSource } from '@/core/events'
import type { Address, ChainId, Wei } from '@/core/types'

import type { IAddTokenParams, IToken, ITokenMetadata, ITokenRef, TokenEventMap } from './types'

/**
 * Управление списком отслеживаемых токенов.
 *
 * Сервис читает метаданные и балансы токенов, но не кэширует их:
 * кэширование и фоновое обновление — обязанность `IBalanceService`.
 * Разделение позволяет менять список токенов, не перезапрашивая
 * балансы, и обновлять балансы, не трогая список.
 */
export interface ITokenService extends IEventSource<TokenEventMap> {
  /** Загружает пользовательские токены всех известных сетей. */
  init(): Promise<void>

  /** Отслеживаемые токены сети, включая нативную валюту. */
  list(chainId: ChainId): readonly IToken[]

  get(ref: ITokenRef): IToken | null

  /**
   * Добавляет токен вручную.
   *
   * Реализация обязана прочитать метаданные из контракта и сверить их
   * с переданными. Слепое доверие пользовательскому вводу `decimals`
   * приводит к отображению суммы, отличающейся от реальной на порядки.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  add(params: IAddTokenParams): Promise<IToken>

  /** Убирает токен из отслеживаемых. Нативную валюту убрать нельзя. */
  remove(ref: ITokenRef): Promise<void>

  /**
   * Читает метаданные контракта без добавления в список.
   *
   * Нужен для предварительного показа в форме добавления: пользователь
   * должен увидеть, что за токен он добавляет, до подтверждения.
   *
   * @throws InvalidTokenContractError
   */
  fetchMetadata(chainId: ChainId, address: Address): Promise<ITokenMetadata>

  /**
   * Баланс токена на адресе, в минимальных единицах.
   *
   * @throws InvalidTokenContractError, UnsupportedTokenStandardError
   */
  getBalance(ref: ITokenRef, owner: Address): Promise<Wei>

  /**
   * Обнаруживает токены, приходившие на адрес.
   *
   * ВАЖНО: обнаруженные токены НЕ добавляются автоматически. Кто угодно
   * может бесплатно прислать на адрес токен-приманку с именем, повторяющим
   * известный проект. Автодобавление превращает кошелёк в площадку показа
   * мошеннических названий. Решение о добавлении принимает пользователь.
   */
  detect(chainId: ChainId, owner: Address): Promise<readonly ITokenMetadata[]>
}

/** Долговременное хранение пользовательского списка токенов. */
export interface ITokenRepository {
  findAll(chainId: ChainId): Promise<readonly IToken[]>
  find(ref: ITokenRef): Promise<IToken | null>
  save(token: IToken): Promise<void>
  delete(ref: ITokenRef): Promise<void>
}
