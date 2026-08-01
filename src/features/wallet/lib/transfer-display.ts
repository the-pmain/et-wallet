import { TRANSFER_KIND, type INetworkConfig, type ITransferRecord, type TransferKind } from '@/core'

import { formatTokenAmount } from './format'

/** Готовая к показу сумма перевода. */
export interface ITransferAmount {
  /** Числовое значение для показа. */
  readonly text: string

  /** Обозначение: символ токена, идентификатор предмета либо пометка. */
  readonly unit: string

  /**
   * Величина показана в необработанных единицах.
   *
   * Значит, число знаков контракта неизвестно, и сравнивать эту сумму
   * с другими нельзя. Интерфейс обязан пометить такую строку.
   */
  readonly isRaw: boolean
}

/**
 * Приводит перевод к виду, пригодному для показа.
 *
 * ЧИСЛО ЗНАКОВ НИКОГДА НЕ ДОДУМЫВАЕТСЯ. Привычные восемнадцать знаков —
 * соглашение, а не правило: у USDC их шесть, у WBTC восемь, у отдельных
 * токенов ноль. Подстановка восемнадцати для токена с шестью занизила бы
 * показанную сумму в триллион раз, и пользователь решил бы, что перевода
 * почти не было.
 *
 * Поэтому при неизвестном числе знаков выводятся необработанные единицы
 * с пометкой `isRaw`, а не правдоподобная, но выдуманная величина.
 *
 * СИМВОЛ ТОКЕНА НЕДОВЕРЕННЫЙ: его задаёт автор контракта, и выпустить
 * токен с символом `USDC` может кто угодно. Здесь он лишь передаётся
 * дальше; отличать проверенные токены от произвольных — задача
 * интерфейса.
 */
export function describeAmount(
  record: ITransferRecord,
  network: INetworkConfig | null,
): ITransferAmount {
  if (record.kind === TRANSFER_KIND.Erc721) {
    /* Уникальный предмет не имеет количества: показывать «1» бессмысленно,
       значение несёт идентификатор. */
    return {
      text: record.tokenId === null ? '—' : `#${record.tokenId.toString()}`,
      unit: record.asset.symbol ?? 'NFT',
      isRaw: false,
    }
  }

  if (record.kind === TRANSFER_KIND.Native) {
    const decimals = network?.nativeCurrency.decimals ?? record.asset.decimals

    return decimals === null
      ? { text: record.value.toString(), unit: 'ед.', isRaw: true }
      : {
          text: formatTokenAmount(record.value, decimals),
          unit: network?.nativeCurrency.symbol ?? record.asset.symbol ?? '',
          isRaw: false,
        }
  }

  if (record.asset.decimals === null) {
    return {
      text: record.value.toString(),
      unit: record.asset.symbol ?? 'ед.',
      isRaw: true,
    }
  }

  return {
    text: formatTokenAmount(record.value, record.asset.decimals),
    unit: record.asset.symbol ?? '',
    isRaw: false,
  }
}

/** Человекочитаемое название категории перевода. */
export function describeKind(kind: TransferKind): string {
  switch (kind) {
    case TRANSFER_KIND.Native:
      return 'Перевод'
    case TRANSFER_KIND.Erc20:
      return 'Токен'
    case TRANSFER_KIND.Erc721:
      return 'NFT'
    case TRANSFER_KIND.Erc1155:
      return 'NFT (ERC-1155)'
  }
}
