import { describe, expect, it } from 'vitest'

import {
  formatMarketChange,
  formatMarketPrice,
  formatMarketUsd,
  isMarketChangeUp,
} from './market-display'

describe('formatMarketPrice', () => {
  it('не подменяет неизвестную цену нулём', () => {
    expect(formatMarketPrice(null)).toBe('—')
  })

  it('показывает крупные цены с центами', () => {
    expect(formatMarketPrice(71_947.59)).toBe('$71,947.59')
  })

  it('не прячет цену меньше цента', () => {
    /* `formatFiat` здесь солгал бы «< $0.01». */
    expect(formatMarketPrice(0.00000487)).toBe('$0.00000487')
  })
})

describe('formatMarketUsd', () => {
  it('показывает капитализацию без центов', () => {
    expect(formatMarketUsd(66_358_006_353)).toBe('$66,358,006,353')
  })
})

describe('formatMarketChange', () => {
  it('не ставит знак в строку: направление у треугольника', () => {
    expect(formatMarketChange(11.5)).toBe('11.5%')
    expect(formatMarketChange(-0.4)).toBe('0.4%')
  })

  it('считает ноль после округления ростом', () => {
    expect(isMarketChangeUp(-0.04)).toBe(true)
    expect(isMarketChangeUp(-0.4)).toBe(false)
  })
})
