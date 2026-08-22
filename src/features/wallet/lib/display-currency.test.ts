import { describe, expect, it } from 'vitest'

import {
  DISPLAY_CURRENCY,
  convertFromUsd,
  formatDisplayFiat,
  parseDisplayAmount,
} from './display-currency'

const RATES = { USD: 1, EUR: 0.8, GBP: 0.5 } as const

describe('formatDisplayFiat', () => {
  it('рисует доллары без перевода', () => {
    expect(formatDisplayFiat(350, DISPLAY_CURRENCY.Usd, RATES)).toBe('$350.00')
  })

  it('переводит в евро и фунты по курсу', () => {
    expect(formatDisplayFiat(100, DISPLAY_CURRENCY.Eur, RATES)).toBe('€80.00')
    expect(formatDisplayFiat(100, DISPLAY_CURRENCY.Gbp, RATES)).toBe('£50.00')
  })

  it('не подменяет неизвестную сумму нулём', () => {
    expect(formatDisplayFiat(null, DISPLAY_CURRENCY.Usd, RATES)).toBe('—')
  })

  it('прячет суммы меньше цента за порогом в выбранной валюте', () => {
    expect(formatDisplayFiat(0.005, DISPLAY_CURRENCY.Usd, RATES)).toBe('< $0.01')
    expect(formatDisplayFiat(0.005, DISPLAY_CURRENCY.Eur, RATES)).toBe('< €0.01')
  })
})

describe('parseDisplayAmount', () => {
  it('читает число и отбрасывает мусор', () => {
    expect(parseDisplayAmount('43')).toBe(43)
    expect(parseDisplayAmount('0')).toBe(0)
    expect(parseDisplayAmount('')).toBeNull()
  })
})

describe('convertFromUsd', () => {
  it('для доллара оставляет величину', () => {
    expect(convertFromUsd(250, DISPLAY_CURRENCY.Usd, RATES)).toBe(250)
  })
})
