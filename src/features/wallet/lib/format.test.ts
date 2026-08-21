import { describe, expect, it } from 'vitest'

import { formatExactTokenAmount, formatTokenAmount, shortenAddress } from './format'

const ETH_DECIMALS = 18

describe('formatTokenAmount', () => {
  it('показывает целое значение без дробной части', () => {
    expect(formatTokenAmount(10n ** 18n, ETH_DECIMALS)).toBe('1')
  })

  it('показывает ноль как ноль', () => {
    expect(formatTokenAmount(0n, ETH_DECIMALS)).toBe('0')
  })

  it('дополняет дробную часть ведущими нулями', () => {
    /* 0.05 ETH — это 5·10^16 wei. Без дополнения остаток «5» был бы
       прочитан как 0.5, то есть в десять раз больше. */
    expect(formatTokenAmount(50_000_000_000_000_000n, ETH_DECIMALS)).toBe('0.05')
  })

  it('убирает незначащие нули справа', () => {
    expect(formatTokenAmount(1_500_000_000_000_000_000n, ETH_DECIMALS)).toBe('1.5')
  })

  it('усекает, а не округляет вверх', () => {
    /* 1.9999999 ETH при шести знаках обязано показываться как 1.999999:
       округление до 2 позволило бы попытаться отправить недоступную сумму. */
    expect(formatTokenAmount(1_999_999_900_000_000_000n, ETH_DECIMALS)).toBe('1.999999')
  })

  it('никогда не показывает ненулевой остаток как ноль', () => {
    /* Один wei меньше отображаемой точности. Показанный «0» означал бы
       «средств нет», что неверно. */
    expect(formatTokenAmount(1n, ETH_DECIMALS)).toBe('<0.000001')
  })

  it('сохраняет целую часть при слишком малом остатке', () => {
    expect(formatTokenAmount(10n ** 18n + 1n, ETH_DECIMALS)).toBe('<1.000001')
  })

  it('работает с токенами, у которых иное число знаков', () => {
    expect(formatTokenAmount(1_500_000n, 6)).toBe('1.5')
  })

  it('работает с токеном без дробной части', () => {
    expect(formatTokenAmount(42n, 0)).toBe('42')
  })

  it('обрабатывает отрицательное значение', () => {
    expect(formatTokenAmount(-(10n ** 18n), ETH_DECIMALS)).toBe('-1')
  })

  it('не теряет точность на суммах за пределами Number.MAX_SAFE_INTEGER', () => {
    const raw = 123_456_789_123_456_789_123_456_789n

    expect(formatTokenAmount(raw, ETH_DECIMALS)).toBe('123456789.123456')
  })
})

describe('formatExactTokenAmount', () => {
  it('показывает целые единицы токена без минимальных единиц', () => {
    expect(formatExactTokenAmount(2n * 10n ** 18n, ETH_DECIMALS)).toBe('2')
  })

  it('сохраняет дробную часть целиком', () => {
    expect(formatExactTokenAmount(1n, ETH_DECIMALS)).toBe('0.000000000000000001')
    expect(formatExactTokenAmount(1_500_000n, 6)).toBe('1.5')
  })

  it('показывает ноль как ноль', () => {
    expect(formatExactTokenAmount(0n, ETH_DECIMALS)).toBe('0')
  })
})

describe('shortenAddress', () => {
  it('сохраняет регистр контрольной суммы EIP-55', () => {
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

    expect(shortenAddress(address)).toBe('0x5aAe…1BeAed')
  })

  it('не трогает короткую строку', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234')
  })
})
