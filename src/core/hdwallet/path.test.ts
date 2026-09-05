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

describe('BIP-44 constants', () => {
  it('match the standard', () => {
    expect(BIP44_PURPOSE).toBe(44)
    expect(EVM_COIN_TYPE).toBe(60)
    expect(CHANGE_EXTERNAL).toBe(0)
    expect(HARDENED_OFFSET).toBe(2147483648)
  })
})

describe('path building', () => {
  it('builds the default account path', () => {
    expect(buildAccountPath()).toBe("m/44'/60'/0'")
  })

  it('builds the default chain path', () => {
    expect(buildChangePath()).toBe("m/44'/60'/0'/0")
  })

  it("builds the path the stage asked for, m/44'/60'/0'/0/n", () => {
    expect(buildAddressPath(0)).toBe("m/44'/60'/0'/0/0")
    expect(buildAddressPath(5)).toBe("m/44'/60'/0'/0/5")
    expect(buildAddressPath(2147483647)).toBe("m/44'/60'/0'/0/2147483647")
  })

  it('supports the Ledger Live convention of incrementing the account index', () => {
    expect(buildAddressPath(0, { accountIndex: 3 })).toBe("m/44'/60'/3'/0/0")
  })

  it('supports another coin type', () => {
    expect(buildAddressPath(0, { coinType: 61 })).toBe("m/44'/61'/0'/0/0")
  })

  it('supports the internal chain', () => {
    expect(buildAddressPath(2, { change: 1 })).toBe("m/44'/60'/0'/1/2")
  })

  it('rejects a negative address index', () => {
    expect(() => buildAddressPath(-1)).toThrow(InvalidDerivationPathError)
  })

  it('rejects an index in the hardened range', () => {
    expect(() => buildAddressPath(HARDENED_OFFSET)).toThrow(InvalidDerivationPathError)
  })

  it('rejects a fractional index', () => {
    expect(() => buildAddressPath(1.5)).toThrow(InvalidDerivationPathError)
  })
})

describe('toDerivationPath', () => {
  it('accepts a valid path', () => {
    expect(toDerivationPath("m/44'/60'/0'/0/0")).toBe("m/44'/60'/0'/0/0")
  })

  it('accepts the root path', () => {
    expect(toDerivationPath('m')).toBe('m')
  })

  it('accepts a path without hardened levels', () => {
    expect(toDerivationPath('m/0/1')).toBe('m/0/1')
  })

  it('rejects a path without a leading m', () => {
    expect(() => toDerivationPath("44'/60'/0'/0/0")).toThrow(InvalidDerivationPathError)
  })

  it('rejects a path with a trailing slash', () => {
    expect(() => toDerivationPath("m/44'/60'/")).toThrow(InvalidDerivationPathError)
  })

  it('rejects a non-numeric level', () => {
    expect(() => toDerivationPath("m/44'/eth'/0'")).toThrow(InvalidDerivationPathError)
  })

  it('rejects an index outside the range', () => {
    expect(() => toDerivationPath('m/2147483648')).toThrow(InvalidDerivationPathError)
  })
})

describe('assertValidIndex', () => {
  it('lets through boundary legal values', () => {
    expect(() => {
      assertValidIndex(0, 'index')
    }).not.toThrow()
    expect(() => {
      assertValidIndex(HARDENED_OFFSET - 1, 'index')
    }).not.toThrow()
  })

  it('rejects a value on the hardened-derivation boundary', () => {
    expect(() => {
      assertValidIndex(HARDENED_OFFSET, 'index')
    }).toThrow(InvalidDerivationPathError)
  })
})

describe('parseBip44Path', () => {
  it('parses a standard path', () => {
    expect(parseBip44Path("m/44'/60'/0'/0/7")).toEqual({
      purpose: 44,
      coinType: 60,
      accountIndex: 0,
      change: 0,
      addressIndex: 7,
    })
  })

  it('parses a path in the Ledger Live convention', () => {
    expect(parseBip44Path("m/44'/60'/3'/0/0").accountIndex).toBe(3)
  })

  it('is reversible relative to buildAddressPath', () => {
    const path = buildAddressPath(11, { accountIndex: 2, change: 1, coinType: 61 })

    expect(parseBip44Path(path)).toEqual({
      purpose: 44,
      coinType: 61,
      accountIndex: 2,
      change: 1,
      addressIndex: 11,
    })
  })

  it('rejects a path of the wrong depth', () => {
    expect(() => parseBip44Path("m/44'/60'/0'/0")).toThrow(InvalidDerivationPathError)
  })

  it('rejects non-hardened first three levels', () => {
    expect(() => parseBip44Path('m/44/60/0/0/0')).toThrow(InvalidDerivationPathError)
  })

  it('rejects a hardened address level', () => {
    /* A hardened addressIndex makes deriving addresses from an
       xpub impossible, i.e. breaks watch-only. */
    expect(() => parseBip44Path("m/44'/60'/0'/0/0'")).toThrow(InvalidDerivationPathError)
  })

  it('rejects a hardened change level', () => {
    expect(() => parseBip44Path("m/44'/60'/0'/0'/0")).toThrow(InvalidDerivationPathError)
  })
})
