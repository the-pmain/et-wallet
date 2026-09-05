import { describe, expect, it } from 'vitest'

import {
  DISPLAY_CURRENCY,
  convertFromUsd,
  formatDisplayFiat,
  parseDisplayAmount,
} from './display-currency'

const RATES = { USD: 1, EUR: 0.8, GBP: 0.5 } as const

describe('formatDisplayFiat', () => {
  it('draws dollars without converting', () => {
    expect(formatDisplayFiat(350, DISPLAY_CURRENCY.Usd, RATES)).toBe('$350.00')
  })

  it('converts to euros and pounds at the rate', () => {
    expect(formatDisplayFiat(100, DISPLAY_CURRENCY.Eur, RATES)).toBe('€80.00')
    expect(formatDisplayFiat(100, DISPLAY_CURRENCY.Gbp, RATES)).toBe('£50.00')
  })

  it('does not substitute zero for an unknown amount', () => {
    expect(formatDisplayFiat(null, DISPLAY_CURRENCY.Usd, RATES)).toBe('—')
  })

  it('hides amounts below one cent behind a threshold in the selected currency', () => {
    expect(formatDisplayFiat(0.005, DISPLAY_CURRENCY.Usd, RATES)).toBe('< $0.01')
    expect(formatDisplayFiat(0.005, DISPLAY_CURRENCY.Eur, RATES)).toBe('< €0.01')
  })
})

describe('parseDisplayAmount', () => {
  it('reads a number and drops junk', () => {
    expect(parseDisplayAmount('43')).toBe(43)
    expect(parseDisplayAmount('0')).toBe(0)
    expect(parseDisplayAmount('')).toBeNull()
  })
})

describe('convertFromUsd', () => {
  it('leaves the amount unchanged for dollars', () => {
    expect(convertFromUsd(250, DISPLAY_CURRENCY.Usd, RATES)).toBe(250)
  })
})
