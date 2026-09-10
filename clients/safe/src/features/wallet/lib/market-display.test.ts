import { describe, expect, it } from 'vitest'

import {
  formatMarketChange,
  formatMarketPrice,
  formatMarketUsd,
  isMarketChangeUp,
} from './market-display'

describe('formatMarketPrice', () => {
  it('does not substitute zero for an unknown price', () => {
    expect(formatMarketPrice(null)).toBe('—')
  })

  it('shows large prices with cents', () => {
    expect(formatMarketPrice(71_947.59)).toBe('$71,947.59')
  })

  it('does not hide a price below one cent', () => {
    /* `formatFiat` would lie here with "< $0.01". */
    expect(formatMarketPrice(0.00000487)).toBe('$0.00000487')
  })
})

describe('formatMarketUsd', () => {
  it('shows market cap without cents', () => {
    expect(formatMarketUsd(66_358_006_353)).toBe('$66,358,006,353')
  })
})

describe('formatMarketChange', () => {
  it('does not put a sign in the string: direction is the triangle', () => {
    expect(formatMarketChange(11.5)).toBe('11.5%')
    expect(formatMarketChange(-0.4)).toBe('0.4%')
  })

  it('treats a rounded-to-zero change as growth', () => {
    expect(isMarketChangeUp(-0.04)).toBe(true)
    expect(isMarketChangeUp(-0.4)).toBe(false)
  })
})
