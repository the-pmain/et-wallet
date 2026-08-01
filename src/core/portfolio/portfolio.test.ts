import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { priceRefKey, type IPriceQuote, type PriceMap } from '@/core/price'
import { TOKEN_STANDARD, type IToken } from '@/core/token'
import { toChainId, type Timestamp } from '@/core/types'

import { buildPortfolio, toWholeUnits, type ITokenAmount } from './portfolio'

const CHAIN_ID = toChainId(1n)

const NOW = 1_785_000_000_000 as Timestamp

/** Токен с заданными знаками и адресом. */
function token(symbol: string, decimals: number, address: string | null): IToken {
  return {
    chainId: CHAIN_ID,
    address: address === null ? null : toAddress(address),
    standard: address === null ? TOKEN_STANDARD.Native : TOKEN_STANDARD.Erc20,
    symbol,
    name: symbol,
    decimals,
    logoUri: null,
    isCustom: false,
    addedAt: NOW,
  }
}

const ETH = token('ETH', 18, null)
const USDC = token('USDC', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const WBTC = token('WBTC', 8, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')

/** Котировка с заданной ценой и суточным изменением. */
function quote(price: number, change24hPercent: number | null = null): IPriceQuote {
  return { price, change24hPercent, updatedAt: NOW }
}

/** Собирает словарь котировок по токенам. */
function prices(entries: readonly (readonly [IToken, IPriceQuote])[]): PriceMap {
  return new Map(
    entries.map(([item, value]) => [
      priceRefKey({ chainId: item.chainId, address: item.address }),
      value,
    ]),
  )
}

describe('toWholeUnits', () => {
  it('переводит целое число минимальных единиц', () => {
    expect(toWholeUnits(2_000_000n, 6)).toBe(2)
  })

  it('учитывает дробную часть', () => {
    expect(toWholeUnits(1_500_000n, 6)).toBeCloseTo(1.5, 10)
  })

  it('работает с восемнадцатью знаками без потери порядка', () => {
    /* Прямое `Number(balance)` на таких величинах выходит за пределы
       точного представления ещё до деления. */
    expect(toWholeUnits(10n ** 18n, 18)).toBe(1)
    expect(toWholeUnits(1_234_500_000_000_000_000n, 18)).toBeCloseTo(1.2345, 10)
  })

  it('работает с нулём знаков', () => {
    expect(toWholeUnits(7n, 0)).toBe(7)
  })

  it('нулевой баланс даёт ноль', () => {
    expect(toWholeUnits(0n, 18)).toBe(0)
  })
})

describe('buildPortfolio: оценка', () => {
  it('пустой список даёт пустую сводку', () => {
    const summary = buildPortfolio([], new Map())

    expect(summary.totalValue).toBe(0)
    expect(summary.positions).toEqual([])
  })

  it('считает стоимость позиции по курсу и числу знаков', () => {
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_500_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.totalValue).toBeCloseTo(1.5, 8)
  })

  it('складывает позиции с разным числом знаков', () => {
    const amounts: ITokenAmount[] = [
      { token: ETH, balance: 10n ** 18n },
      { token: USDC, balance: 2_000_000n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.totalValue).toBeCloseTo(2002, 6)
  })

  it('считает доли позиций', () => {
    const amounts: ITokenAmount[] = [
      { token: ETH, balance: 10n ** 18n },
      { token: USDC, balance: 1_000_000_000n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(1000)],
        [USDC, quote(1)],
      ]),
    )

    const shares = summary.positions.map((position) => position.share)

    expect(shares[0]).toBeCloseTo(0.5, 8)
    expect(shares[1]).toBeCloseTo(0.5, 8)
  })

  it('упорядочивает позиции по убыванию стоимости', () => {
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.positions.map((position) => position.token.symbol)).toEqual(['ETH', 'USDC'])
  })
})

describe('buildPortfolio: неизвестное не считается нулём', () => {
  it('позиция без курса не входит в сумму', () => {
    /* Ноль вместо неизвестного курса занизил бы портфель молча. */
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: WBTC, balance: 100_000_000n },
    ]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.totalValue).toBeCloseTo(1, 8)
    expect(summary.positionsWithoutPrice).toBe(1)
  })

  it('позиция без курса остаётся в списке', () => {
    /* Актив, курс которого неизвестен, остаётся активом: не показать
       его значило бы скрыть от владельца часть его средств. */
    const amounts: ITokenAmount[] = [{ token: WBTC, balance: 100_000_000n }]
    const summary = buildPortfolio(amounts, new Map())

    expect(summary.positions).toHaveLength(1)
    expect(summary.positions[0]?.value).toBeNull()
    expect(summary.positions[0]?.share).toBeNull()
  })

  it('позиция без курса уходит в конец списка', () => {
    const amounts: ITokenAmount[] = [
      { token: WBTC, balance: 100_000_000n },
      { token: USDC, balance: 1_000_000n },
    ]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.positions.map((position) => position.token.symbol)).toEqual(['USDC', 'WBTC'])
  })

  it('позиция с неполученным балансом не входит в сумму', () => {
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: null },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [ETH, quote(2000)],
        [USDC, quote(1)],
      ]),
    )

    expect(summary.totalValue).toBeCloseTo(2000, 6)
    expect(summary.positionsWithoutBalance).toBe(1)
  })

  it('нулевой баланс — это ноль, а не неизвестность', () => {
    /* Разница существенна: «на счету пусто» и «узнать не удалось» —
       разные утверждения, и первое проверяемо. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 0n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.positionsWithoutBalance).toBe(0)
    expect(summary.positions[0]?.value).toBe(0)
  })
})

describe('buildPortfolio: суточное изменение', () => {
  it('считает вчерашнюю оценку по суточному изменению курса', () => {
    /* Цена 110 при росте на 10 % означает вчерашние 100. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(110, 10)]]))

    expect(summary.previousValue).toBeCloseTo(100, 6)
    expect(summary.change24hValue).toBeCloseTo(10, 6)
    expect(summary.change24hPercent).toBeCloseTo(10, 6)
  })

  it('считает падение', () => {
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(90, -10)]]))

    expect(summary.change24hPercent).toBeCloseTo(-10, 6)
    expect(summary.change24hValue).toBeLessThan(0)
  })

  it('оставляет изменение неизвестным, если его не дал ни один источник', () => {
    /* «Курс не изменился» и «изменение неизвестно» — разные
       утверждения, и второе нельзя показывать нулём. */
    const amounts: ITokenAmount[] = [{ token: USDC, balance: 1_000_000n }]
    const summary = buildPortfolio(amounts, prices([[USDC, quote(1)]]))

    expect(summary.change24hPercent).toBeNull()
    expect(summary.change24hValue).toBeNull()
    expect(summary.previousValue).toBeNull()
  })

  it('позиция без суточного изменения не завышает изменение портфеля', () => {
    /* Иначе такая позиция выпала бы из вчерашней суммы целиком,
       и портфель показал бы рост на её полную стоимость. */
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 100_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]
    const summary = buildPortfolio(
      amounts,
      prices([
        [USDC, quote(1)],
        [ETH, quote(110, 10)],
      ]),
    )

    /* Вчера: 100 стабильных + 100 эфира = 200. Сегодня: 100 + 110 = 210. */
    expect(summary.previousValue).toBeCloseTo(200, 6)
    expect(summary.change24hPercent).toBeCloseTo(5, 6)
  })
})

describe('buildPortfolio: возраст котировок', () => {
  it('сообщает момент самой старой использованной котировки', () => {
    const older = (NOW - 60_000) as Timestamp
    const amounts: ITokenAmount[] = [
      { token: USDC, balance: 1_000_000n },
      { token: ETH, balance: 10n ** 18n },
    ]

    const summary = buildPortfolio(
      amounts,
      prices([
        [USDC, { price: 1, change24hPercent: null, updatedAt: older }],
        [ETH, quote(2000)],
      ]),
    )

    expect(summary.oldestQuoteAt).toBe(older)
  })

  it('без оценок возраст неизвестен', () => {
    const summary = buildPortfolio([{ token: USDC, balance: 1_000_000n }], new Map())

    expect(summary.oldestQuoteAt).toBeNull()
  })
})
