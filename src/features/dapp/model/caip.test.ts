import { describe, expect, it } from 'vitest'

import { BUILT_IN_CHAIN_ID, MAX_CHAIN_ID, toAddress, toChainId } from '@/core'

import { parseCaip2, toCaip10, toCaip2 } from './caip'

const OWNER = toAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

describe('toCaip2', () => {
  it.each([
    [BUILT_IN_CHAIN_ID.Ethereum, 'eip155:1'],
    [BUILT_IN_CHAIN_ID.Polygon, 'eip155:137'],
    [BUILT_IN_CHAIN_ID.Arbitrum, 'eip155:42161'],
  ])('строит идентификатор сети %s', (chainId, expected) => {
    expect(toCaip2(chainId)).toBe(expected)
  })
})

describe('toCaip10', () => {
  it('строит идентификатор счёта', () => {
    expect(toCaip10(BUILT_IN_CHAIN_ID.Ethereum, OWNER)).toBe(`eip155:1:${OWNER}`)
  })

  it('сохраняет регистр адреса', () => {
    /* Регистр несёт контрольную сумму EIP-55: приведение к нижнему
       лишило бы получателя единственной защиты от опечатки. */
    expect(toCaip10(BUILT_IN_CHAIN_ID.Ethereum, OWNER)).toContain('0xd8dA6BF2')
  })
})

describe('parseCaip2', () => {
  it('читает сеть обратно', () => {
    expect(parseCaip2('eip155:137')).toBe(BUILT_IN_CHAIN_ID.Polygon)
  })

  it('обратим для любой встроенной сети', () => {
    for (const chainId of Object.values(BUILT_IN_CHAIN_ID)) {
      expect(parseCaip2(toCaip2(chainId))).toBe(chainId)
    }
  })

  it('читает наибольший допустимый идентификатор', () => {
    /* `ChainId` — это `bigint`: предел EIP-2294 (2^53−1) уже выходит
       за пределы безопасного целого в JSON. */
    const large = toChainId(MAX_CHAIN_ID)

    expect(parseCaip2(toCaip2(large))).toBe(large)
  })

  it('отвергает идентификатор сверх предела EIP-2294', () => {
    /* Такой сети не обслуживает ни один узел. Принять её значило бы
       подписать транзакцию для несуществующей цепи. */
    expect(parseCaip2(`eip155:${(MAX_CHAIN_ID + 1n).toString()}`)).toBeNull()
  })

  it.each([
    ['чужое пространство имён', 'solana:mainnet'],
    ['без разделителя', 'eip155'],
    ['нечисловая сеть', 'eip155:mainnet'],
    ['отрицательная сеть', 'eip155:-1'],
    ['шестнадцатеричная запись', 'eip155:0x1'],
    ['пустая строка', ''],
    ['пробел вместо номера', 'eip155: 1'],
  ])('отвергает %s', (_name, value) => {
    /* Подставить сюда значение по умолчанию значило бы выполнить
       запрос не в той сети, о которой просило приложение. */
    expect(parseCaip2(value)).toBeNull()
  })
})
