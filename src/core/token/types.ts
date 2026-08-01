import type { Address, ChainId, Timestamp } from '@/core/types'

/** Поддерживаемые стандарты токенов. */
export const TOKEN_STANDARD = {
  /** Нативная валюта сети. Контракта не имеет. */
  Native: 'native',
  /** Взаимозаменяемые токены. */
  Erc20: 'ERC-20',
  /** Невзаимозаменяемые токены. */
  Erc721: 'ERC-721',
  /** Смешанный стандарт: и взаимозаменяемые, и уникальные в одном контракте. */
  Erc1155: 'ERC-1155',
} as const

export type TokenStandard = (typeof TOKEN_STANDARD)[keyof typeof TOKEN_STANDARD]

/**
 * Ссылка на токен.
 *
 * Минимальный набор для однозначной идентификации. Пара «сеть + адрес»
 * обязательна: один и тот же адрес контракта в разных сетях — разные токены.
 * Индексация только по адресу приводит к показу баланса из одной сети
 * в интерфейсе другой.
 */
export interface ITokenRef {
  readonly chainId: ChainId

  /** Адрес контракта. `null` для нативной валюты. */
  readonly address: Address | null
}

/**
 * Описание токена.
 *
 * Данные из контракта (`symbol`, `name`, `decimals`) считаются
 * НЕДОВЕРЕННЫМИ: их задаёт автор контракта, и ничто не мешает выпустить
 * токен с символом `USDC`. Интерфейс обязан отличать проверенные токены
 * из встроенного списка от добавленных вручную — иначе подделка неотличима
 * от оригинала.
 */
export interface IToken extends ITokenRef {
  readonly standard: TokenStandard

  readonly symbol: string

  readonly name: string

  /**
   * Число десятичных знаков.
   *
   * Критично для корректности сумм: у USDC их 6, у большинства токенов 18.
   * Ошибка в этом поле меняет отображаемую сумму на двенадцать порядков.
   * Значение обязано читаться из контракта, а не предполагаться.
   *
   * Для ERC-721 всегда 0: токен неделим.
   */
  readonly decimals: number

  /** Ссылка на логотип. `null`, если изображение неизвестно. */
  readonly logoUri: string | null

  /**
   * Добавлен вручную пользователем.
   *
   * Отличие от встроенного списка обязано быть видно в интерфейсе:
   * подмена символа известного токена — распространённый приём мошенничества.
   */
  readonly isCustom: boolean

  /** Момент добавления в отслеживаемые. */
  readonly addedAt: Timestamp
}

/** Параметры добавления токена вручную. */
export interface IAddTokenParams {
  readonly chainId: ChainId
  readonly address: Address
  readonly standard?: TokenStandard

  /** Переопределение символа. По умолчанию читается из контракта. */
  readonly symbol?: string
  readonly decimals?: number
}

/** Метаданные, прочитанные непосредственно из контракта. */
export interface ITokenMetadata {
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly standard: TokenStandard
}

/** События слоя токенов. */
export interface TokenEventMap {
  'token:listChanged': { readonly chainId: ChainId }
}
