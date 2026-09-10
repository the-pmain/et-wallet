import { describe, expect, it } from 'vitest'

import { InvalidDerivationPathError } from '@/core/errors'

import {
  BIP44_PURPOSE,
  CHANGE_EXTERNAL,
  EVM_COIN_TYPE,
  HARDENED_OFFSET,
  assertValidIndex,
  buildAccountPath,
  buildAddressPath,
  buildChangePath,
  parseBip44Path,
  toDerivationPath,
} from './path'

describe('константы BIP-44', () => {
  it('соответствуют стандарту', () => {
    expect(BIP44_PURPOSE).toBe(44)
    expect(EVM_COIN_TYPE).toBe(60)
    expect(CHANGE_EXTERNAL).toBe(0)
    expect(HARDENED_OFFSET).toBe(2147483648)
  })
})

describe('построение путей', () => {
  it('строит путь аккаунта по умолчанию', () => {
    expect(buildAccountPath()).toBe("m/44'/60'/0'")
  })

  it('строит путь цепочки по умолчанию', () => {
    expect(buildChangePath()).toBe("m/44'/60'/0'/0")
  })

  it("строит запрошенный этапом путь m/44'/60'/0'/0/n", () => {
    expect(buildAddressPath(0)).toBe("m/44'/60'/0'/0/0")
    expect(buildAddressPath(5)).toBe("m/44'/60'/0'/0/5")
    expect(buildAddressPath(2147483647)).toBe("m/44'/60'/0'/0/2147483647")
  })

  it('поддерживает соглашение Ledger Live с наращиванием индекса аккаунта', () => {
    expect(buildAddressPath(0, { accountIndex: 3 })).toBe("m/44'/60'/3'/0/0")
  })

  it('поддерживает другой тип монеты', () => {
    expect(buildAddressPath(0, { coinType: 61 })).toBe("m/44'/61'/0'/0/0")
  })

  it('поддерживает внутреннюю цепочку', () => {
    expect(buildAddressPath(2, { change: 1 })).toBe("m/44'/60'/0'/1/2")
  })

  it('отвергает отрицательный индекс адреса', () => {
    expect(() => buildAddressPath(-1)).toThrow(InvalidDerivationPathError)
  })

  it('отвергает индекс в диапазоне закалённой деривации', () => {
    expect(() => buildAddressPath(HARDENED_OFFSET)).toThrow(InvalidDerivationPathError)
  })

  it('отвергает дробный индекс', () => {
    expect(() => buildAddressPath(1.5)).toThrow(InvalidDerivationPathError)
  })
})

describe('toDerivationPath', () => {
  it('принимает корректный путь', () => {
    expect(toDerivationPath("m/44'/60'/0'/0/0")).toBe("m/44'/60'/0'/0/0")
  })

  it('принимает корневой путь', () => {
    expect(toDerivationPath('m')).toBe('m')
  })

  it('принимает путь без закалённых уровней', () => {
    expect(toDerivationPath('m/0/1')).toBe('m/0/1')
  })

  it('отвергает путь без ведущего m', () => {
    expect(() => toDerivationPath("44'/60'/0'/0/0")).toThrow(InvalidDerivationPathError)
  })

  it('отвергает путь с завершающим слэшем', () => {
    expect(() => toDerivationPath("m/44'/60'/")).toThrow(InvalidDerivationPathError)
  })

  it('отвергает нечисловой уровень', () => {
    expect(() => toDerivationPath("m/44'/eth'/0'")).toThrow(InvalidDerivationPathError)
  })

  it('отвергает индекс за пределами диапазона', () => {
    expect(() => toDerivationPath('m/2147483648')).toThrow(InvalidDerivationPathError)
  })
})

describe('assertValidIndex', () => {
  it('пропускает граничные допустимые значения', () => {
    expect(() => {
      assertValidIndex(0, 'index')
    }).not.toThrow()
    expect(() => {
      assertValidIndex(HARDENED_OFFSET - 1, 'index')
    }).not.toThrow()
  })

  it('отвергает значение на границе закалённой деривации', () => {
    expect(() => {
      assertValidIndex(HARDENED_OFFSET, 'index')
    }).toThrow(InvalidDerivationPathError)
  })
})

describe('parseBip44Path', () => {
  it('разбирает стандартный путь', () => {
    expect(parseBip44Path("m/44'/60'/0'/0/7")).toEqual({
      purpose: 44,
      coinType: 60,
      accountIndex: 0,
      change: 0,
      addressIndex: 7,
    })
  })

  it('разбирает путь в соглашении Ledger Live', () => {
    expect(parseBip44Path("m/44'/60'/3'/0/0").accountIndex).toBe(3)
  })

  it('обратим относительно buildAddressPath', () => {
    const path = buildAddressPath(11, { accountIndex: 2, change: 1, coinType: 61 })

    expect(parseBip44Path(path)).toEqual({
      purpose: 44,
      coinType: 61,
      accountIndex: 2,
      change: 1,
      addressIndex: 11,
    })
  })

  it('отвергает путь неверной глубины', () => {
    expect(() => parseBip44Path("m/44'/60'/0'/0")).toThrow(InvalidDerivationPathError)
  })

  it('отвергает незакалённые первые три уровня', () => {
    expect(() => parseBip44Path('m/44/60/0/0/0')).toThrow(InvalidDerivationPathError)
  })

  it('отвергает закалённый уровень адреса', () => {
    /* Закалённый addressIndex делает невозможным вывод адресов из xpub,
       то есть ломает режим наблюдения. */
    expect(() => parseBip44Path("m/44'/60'/0'/0/0'")).toThrow(InvalidDerivationPathError)
  })

  it('отвергает закалённый уровень change', () => {
    expect(() => parseBip44Path("m/44'/60'/0'/0'/0")).toThrow(InvalidDerivationPathError)
  })
})
