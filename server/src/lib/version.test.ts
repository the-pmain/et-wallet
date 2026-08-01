import { describe, expect, it } from 'vitest'

import { compareVersions, isValidVersion, parseVersion } from './version.ts'

describe('isValidVersion', () => {
  it('принимает вид МАЖОР.МИНОР.ПАТЧ', () => {
    expect(isValidVersion('1.2.3')).toBe(true)
    expect(isValidVersion('0.0.0')).toBe(true)
    expect(isValidVersion('10.20.30')).toBe(true)
  })

  it('отвергает неполные и лишние составляющие', () => {
    expect(isValidVersion('1.2')).toBe(false)
    expect(isValidVersion('1.2.3.4')).toBe(false)
    expect(isValidVersion('')).toBe(false)
  })

  it('отвергает предвыпускные метки', () => {
    /* Правила упорядочивания предвыпусков сюда не заложены. Принять
       такую строку значило бы сравнить её неверно и молча. */
    expect(isValidVersion('1.2.3-beta.1')).toBe(false)
    expect(isValidVersion('v1.2.3')).toBe(false)
  })
})

describe('parseVersion', () => {
  it('разбирает составляющие в числа', () => {
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 })
  })

  it('отказывает вместо возврата нулей', () => {
    /* Ноль вместо неразобранной версии означал бы «версия 0.0.0»,
       то есть заведомо устаревшая, — утверждение из ничего. */
    expect(() => parseVersion('не версия')).toThrow(/МАЖОР\.МИНОР\.ПАТЧ/u)
  })
})

describe('compareVersions', () => {
  it('считает равные версии равными', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('сравнивает составляющие по старшинству', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0)
  })

  it('сравнивает числа, а не строки', () => {
    /* Строковое сравнение поставило бы `0.10.0` ниже `0.9.0`
       и объявило бы свежую версию устаревшей. */
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })
})
