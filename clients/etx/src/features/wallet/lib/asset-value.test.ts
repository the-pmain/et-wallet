import { describe, expect, it } from 'vitest'

import {
  TOKEN_STANDARD,
  buildPortfolio,
  priceRefKey,
  toAddress,
  toChainId,
  type IBalance,
  type IPriceQuote,
  type IToken,
  type PriceMap,
  type Timestamp,
} from '@/core'

import { estimateNativeValue } from './asset-value'

const ETHEREUM = toChainId(1n)
const BNB_CHAIN = toChainId(56n)

const NOW = 1_785_000_000_000 as Timestamp

function token(chainId: typeof ETHEREUM, symbol: string, decimals: number, address: string | null) {
  return {
    chainId,
    address: address === null ? null : toAddress(address),
    standard: address === null ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol,
    name: symbol,
    decimals,
    logoUri: null,
    isCustom: false,
    isVerified: true,
    addedAt: NOW,
  } satisfies IToken
}

const ETH = token(ETHEREUM, 'ETH', 18, null)
const USDC = token(ETHEREUM, 'USDC', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const BNB = token(BNB_CHAIN, 'BNB', 18, null)

function quote(price: number): IPriceQuote {
  return { price, change24hPercent: null, updatedAt: NOW }
}

function prices(entries: readonly (readonly [IToken, IPriceQuote])[]): PriceMap {
  return new Map(
    entries.map(([item, value]) => [
      priceRefKey({ chainId: item.chainId, address: item.address }),
      value,
    ]),
  )
}

/** Баланс нативной валюты заданной сети. */
function balanceOf(raw: bigint, chainId = ETHEREUM): IBalance {
  return { raw, decimals: 18, chainId, isStale: false } as unknown as IBalance
}

describe('estimateNativeValue: цена ровно того числа, что показано', () => {
  it('умножает показанный баланс на курс нативной валюты', () => {
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), portfolio)).toBe(6000)
  })

  it('считает от свежего баланса, а не от оценки в сводке', () => {
    /* ГЛАВНАЯ ПРОВЕРКА МОДУЛЯ. Кнопка обновления баланса портфель
       не пересчитывает, поэтому сводка законно отстаёт. Готовое
       `value` позиции описывало бы прежнюю сумму — рядом с новой. */
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(portfolio.positions[0]?.value).toBe(6000)
    expect(estimateNativeValue(balanceOf(5n * 10n ** 18n), portfolio)).toBe(15_000)
  })

  it('молчит, когда курс нативной валюты неизвестен', () => {
    /* Курс есть только у токена. Подставить сюда ноль значило бы
       объявить эфир ничего не стоящим. */
    const portfolio = buildPortfolio(
      [
        { token: ETH, balance: 2n * 10n ** 18n },
        { token: USDC, balance: 10n ** 6n },
      ],
      prices([[USDC, quote(1)]]),
    )

    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), portfolio)).toBeNull()
  })

  it('молчит, когда сводка от другой сети', () => {
    /* Промежуток при переключении сети: баланс уже в BNB, сводка ещё
       эфирная. Без сверки полтора BNB были бы оценены в 4500 $. */
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(balanceOf(15n * 10n ** 17n, BNB_CHAIN), portfolio)).toBeNull()
  })

  it('оценивает нативную валюту другой сети по её собственному курсу', () => {
    const portfolio = buildPortfolio(
      [{ token: BNB, balance: 15n * 10n ** 17n }],
      prices([[BNB, quote(600)]]),
    )

    expect(estimateNativeValue(balanceOf(15n * 10n ** 17n, BNB_CHAIN), portfolio)).toBe(900)
  })

  it('молчит без баланса и без сводки', () => {
    const portfolio = buildPortfolio(
      [{ token: ETH, balance: 2n * 10n ** 18n }],
      prices([[ETH, quote(3000)]]),
    )

    expect(estimateNativeValue(null, portfolio)).toBeNull()
    expect(estimateNativeValue(balanceOf(2n * 10n ** 18n), null)).toBeNull()
  })

  it('нулевой баланс оценивается в ноль, а не в неизвестность', () => {
    /* Законный ноль: баланс известен и равен нулю, курс получен.
       Прочерк здесь был бы такой же ложью, как ноль вместо прочерка. */
    const portfolio = buildPortfolio([{ token: ETH, balance: 0n }], prices([[ETH, quote(3000)]]))

    expect(estimateNativeValue(balanceOf(0n), portfolio)).toBe(0)
  })
})
