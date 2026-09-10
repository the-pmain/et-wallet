import { afterEach, describe, expect, it, vi } from 'vitest'

import { RandomnessUnavailableError } from '@/core/errors'

import { getRandomBytes, wipeBytes } from './random'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRandomBytes', () => {
  it('возвращает буфер запрошенного размера', () => {
    expect(getRandomBytes(16)).toHaveLength(16)
    expect(getRandomBytes(32)).toHaveLength(32)
  })

  it('возвращает разные значения при каждом вызове', () => {
    const first = getRandomBytes(32)
    const second = getRandomBytes(32)

    expect([...first]).not.toEqual([...second])
  })

  it('отвергает нулевой и отрицательный размер', () => {
    expect(() => getRandomBytes(0)).toThrow(RandomnessUnavailableError)
    expect(() => getRandomBytes(-1)).toThrow(RandomnessUnavailableError)
  })

  it('отвергает дробный размер', () => {
    expect(() => getRandomBytes(16.5)).toThrow(RandomnessUnavailableError)
  })

  it('отвергает размер сверх лимита Web Crypto', () => {
    expect(() => getRandomBytes(65537)).toThrow(RandomnessUnavailableError)
  })

  it('останавливается при отсутствии Web Crypto, а не переходит на слабый генератор', () => {
    vi.stubGlobal('crypto', undefined)

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
  })

  it('останавливается, если getRandomValues отсутствует', () => {
    vi.stubGlobal('crypto', {})

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
  })

  it('отбраковывает нулевой буфер от неисправного генератора', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect(() => getRandomBytes(16)).toThrow(RandomnessUnavailableError)
    expect(() => getRandomBytes(32)).toThrow(RandomnessUnavailableError)
  })

  it('не отбраковывает нулевой результат на коротких запросах', () => {
    /* Для одного байта ноль — обычное значение исправного генератора,
       он выпадает раз из 256. Отказ на нём был бы ложной тревогой,
       а ложная тревога в системе безопасности приучает не читать
       предупреждения. */
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect(() => getRandomBytes(1)).not.toThrow()
    expect(() => getRandomBytes(8)).not.toThrow()
  })

  it('возвращает нулевые байты на коротком запросе без ошибки', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect([...getRandomBytes(2)]).toEqual([0, 0])
  })
})

describe('wipeBytes', () => {
  it('обнуляет весь буфер', () => {
    const bytes = new Uint8Array([1, 2, 3, 255])
    wipeBytes(bytes)

    expect([...bytes]).toEqual([0, 0, 0, 0])
  })

  it('безопасен для пустого буфера', () => {
    expect(() => {
      wipeBytes(new Uint8Array(0))
    }).not.toThrow()
  })
})
