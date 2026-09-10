import { TRANSFER_DIRECTION, TRANSFER_KIND, type ITransferRecord } from '@/core'

/**
 * Категория для отбора записей.
 *
 * ERC-721 и ERC-1155 сведены в одну категорию «NFT» намеренно: для
 * пользователя это один вид имущества, а разница между стандартами —
 * подробность реализации контракта. Сам стандарт при этом остаётся
 * в записи и показывается в строке списка.
 */
export const TRANSFER_CATEGORY = {
  All: 'all',
  /** Нативная валюта сети. */
  Native: 'native',
  /** Взаимозаменяемые токены ERC-20. */
  Erc20: 'erc20',
  /** Коллекционные токены: ERC-721 и ERC-1155. */
  Nft: 'nft',
} as const

export type TransferCategory = (typeof TRANSFER_CATEGORY)[keyof typeof TRANSFER_CATEGORY]

/** Направление для отбора записей. */
export const DIRECTION_FILTER = {
  All: 'all',
  Incoming: 'incoming',
  Outgoing: 'outgoing',
} as const

export type DirectionFilter = (typeof DIRECTION_FILTER)[keyof typeof DIRECTION_FILTER]

/** Условия отбора, заданные пользователем. */
export interface ITransferFilter {
  readonly category: TransferCategory
  readonly direction: DirectionFilter

  /** Строка поиска в том виде, в каком её ввёл пользователь. */
  readonly query: string
}

/** Условия, не отсеивающие ничего. Исходное состояние экрана. */
export const EMPTY_TRANSFER_FILTER: ITransferFilter = {
  category: TRANSFER_CATEGORY.All,
  direction: DIRECTION_FILTER.All,
  query: '',
}

/**
 * Отсеивает ли текущий набор условий хоть что-нибудь.
 *
 * Нужен интерфейсу, чтобы отличить пустую историю от пустого результата
 * отбора. Это разные утверждения: «операций не было» и «под условия
 * ничего не подошло». Первое, показанное вместо второго, читается
 * владельцем средств как пропажа.
 */
export function isFilterActive(filter: ITransferFilter): boolean {
  return (
    filter.category !== TRANSFER_CATEGORY.All ||
    filter.direction !== DIRECTION_FILTER.All ||
    filter.query.trim() !== ''
  )
}

/**
 * Отбирает записи истории по заданным условиям.
 *
 * ФУНКЦИЯ РАБОТАЕТ ТОЛЬКО С УЖЕ ПОЛУЧЕННЫМИ ЗАПИСЯМИ и ничего не знает
 * об ограничениях источника. Отсутствие записей в результате не означает
 * отсутствия таких операций в сети — об этом обязан сказать интерфейс,
 * опираясь на `IHistoryLimits`.
 */
export function filterTransfers(
  transfers: readonly ITransferRecord[],
  filter: ITransferFilter,
): readonly ITransferRecord[] {
  const query = filter.query.trim().toLowerCase()

  return transfers.filter(
    (record) =>
      matchesCategory(record, filter.category) &&
      matchesDirection(record, filter.direction) &&
      matchesQuery(record, query),
  )
}

/** Подходит ли запись под выбранную категорию. */
function matchesCategory(record: ITransferRecord, category: TransferCategory): boolean {
  switch (category) {
    case TRANSFER_CATEGORY.All:
      return true
    case TRANSFER_CATEGORY.Native:
      return record.kind === TRANSFER_KIND.Native
    case TRANSFER_CATEGORY.Erc20:
      return record.kind === TRANSFER_KIND.Erc20
    case TRANSFER_CATEGORY.Nft:
      return record.kind === TRANSFER_KIND.Erc721 || record.kind === TRANSFER_KIND.Erc1155
  }
}

/**
 * Подходит ли запись под выбранное направление.
 *
 * Перевод самому себе считается подходящим и под «входящие», и под
 * «исходящие»: он одновременно и то и другое. Исключение его из обоих
 * наборов скрыло бы от пользователя существующую операцию — а скрытая
 * операция в истории кошелька хуже лишней.
 */
function matchesDirection(record: ITransferRecord, direction: DirectionFilter): boolean {
  if (direction === DIRECTION_FILTER.All || record.direction === TRANSFER_DIRECTION.Self) {
    return true
  }

  return record.direction === direction
}

/**
 * Совпадает ли запись со строкой поиска.
 *
 * ПОИСК ВЕДЁТСЯ ПО ПОДСТРОКЕ, А НЕ ПО НАЧАЛУ СТРОКИ. Совпадение по началу
 * не нашло бы адрес, от которого пользователь помнит последние символы, —
 * а именно они видны в усечённой записи адреса в списке. Пустой результат
 * поиска пользователь читает как «таких операций не было», и ошибка
 * в эту сторону обходится дороже лишней строки в выдаче: лишнюю он
 * увидит и отбросит, отсутствующую — нет.
 *
 * Регистр не учитывается: один и тот же адрес приходит и в нижнем
 * регистре от узла, и в записи с контрольной суммой EIP-55.
 *
 * @param query Строка поиска, уже приведённая к нижнему регистру
 *        и очищенная от пробелов по краям.
 */
function matchesQuery(record: ITransferRecord, query: string): boolean {
  if (query === '') {
    return true
  }

  const haystack = [
    record.hash,
    record.from,
    record.to,
    record.asset.contract,
    record.asset.symbol,
    record.tokenId === null ? null : `#${record.tokenId.toString()}`,
  ]

  return haystack.some((field) => field !== null && field.toLowerCase().includes(query))
}
