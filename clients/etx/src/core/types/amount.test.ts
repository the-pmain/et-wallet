import { describe, expect, it } from 'vitest'

import { InvalidArgumentError } from '@/core/errors'

import { MAX_UINT256, toTokenUnits, toWei } from './amount'

describe('toWei', () => {
  it('принимает bigint, number и строку', () => {
    expect(toWei(1n)).toBe(1n)
    expect(toWei(1000)).toBe(1000n)
    expect(toWei('1000000000000000000')).toBe(1_000_000_000_000_000_000n)
  })

  it('принимает ноль', () => {
    expect(toWei(0)).toBe(0n)
  })

  it('принимает максимум, представимый в EVM', () => {
    expect(toWei(MAX_UINT256)).toBe(MAX_UINT256)
  })

  it('отвергает отрицательные значения', () => {
    /* В EVM отрицательных сумм не существует: знак при кодировании
       превратился бы в огромное положительное число. */
    expect(() => toWei(-1n)).toThrow(InvalidArgumentError)
    expect(() => toWei('-1')).toThrow(InvalidArgumentError)
  })

  it('отвергает значения сверх 2^256-1', () => {
    expect(() => toWei(MAX_UINT256 + 1n)).toThrow(InvalidArgumentError)
  })

  it('отвергает дробные значения', () => {
    /* Wei неделим. Округление здесь означало бы молчаливое изменение
       суммы перевода. */
    expect(() => toWei(1.5)).toThrow(InvalidArgumentError)
  })

  it('отвергает number вне безопасного диапазона', () => {
    /* BigInt(2**53 + 1) молча даёт уже потерявшее точность значение —
       случай опаснее дробного, потому что не заметен. */
    expect(() => toWei(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidArgumentError)
  })

  it('отвергает нечисловые строки', () => {
    expect(() => toWei('много')).toThrow(InvalidArgumentError)
  })

  it('отвергает NaN и бесконечность', () => {
    expect(() => toWei(Number.NaN)).toThrow(InvalidArgumentError)
    expect(() => toWei(Number.POSITIVE_INFINITY)).toThrow(InvalidArgumentError)
  })

  it('сохраняет точность на значениях выше 2^53', () => {
    const huge = '123456789012345678901234567890'

    expect(toWei(huge).toString()).toBe(huge)
  })
})

describe('toTokenUnits', () => {
  it('принимает те же значения, что и toWei', () => {
    expect(toTokenUnits('1000000')).toBe(1_000_000n)
  })

  it('отвергает отрицательные значения', () => {
    expect(() => toTokenUnits(-1n)).toThrow(InvalidArgumentError)
  })
})
