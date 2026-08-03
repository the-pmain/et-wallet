import { describe, expect, it } from 'vitest'

import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'

import { findTokenImpersonation } from './impersonation'
import { listVerifiedTokens } from './verified'

const ETHEREUM = BUILT_IN_CHAIN_ID.Ethereum

/** Проверенный USDC сети Ethereum. */
const USDC = toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

/** Чужой контракт. */
const IMPOSTOR = toAddress('0x1111111111111111111111111111111111111111')

/** Ищет подделку среди проверенных токенов Ethereum. */
function check(symbol: string, name = 'Some Token', address = IMPOSTOR) {
  return findTokenImpersonation({ chainId: ETHEREUM, address, symbol, name })
}

describe('Подделка под проверенный токен', () => {
  it('чужой контракт с символом проверенного распознаётся', () => {
    /* Символ задаёт автор контракта: назваться `USDC` может любой,
       а владелец увидит в списке привычное и отправит средства. */
    expect(check('USDC')?.verified.address).toBe(USDC)
  })

  it('кириллическая буква в символе не спасает', () => {
    /* `USDС` с кириллической `С` не совпадает с настоящим ни в одном
       байте, а на экране это то же слово. */
    const found = check('USD\u0421')

    expect(found?.verified.address).toBe(USDC)
    expect(found?.foreignCharacters).toEqual(['\u0421'])
  })

  it('совпадение по имени тоже распознаётся', () => {
    const found = check('XYZ', 'USD Coin')

    expect(found?.field).toBe('name')
  })

  it('символ проверяется раньше имени', () => {
    /* Символ показан в списке активов и в подтверждении отправки,
       полное имя видно не везде. */
    expect(check('USDC', 'USD Coin')?.field).toBe('symbol')
  })

  it('сам проверенный контракт подделкой не считается', () => {
    /* Он вправе называться своим именем. */
    expect(check('USDC', 'USD Coin', USDC)).toBeNull()
  })

  it('обычный токен тревоги не вызывает', () => {
    /* Ложная тревога хуже отсутствия проверки: она приучает
       не читать предупреждения. */
    expect(check('MYTOKEN', 'My Own Token')).toBeNull()
    expect(check('SHIB', 'Shiba Inu')).toBeNull()
  })

  it('пустой символ совпадением не считается', () => {
    /* Пустой скелет совпал бы с чем угодно. */
    expect(check('', '')).toBeNull()
  })

  it('проверка идёт по своей сети', () => {
    /* У каждой сети свой список: адрес USDC в Polygon другой,
       и сравнивать надо с ним. */
    const polygon = listVerifiedTokens(BUILT_IN_CHAIN_ID.Polygon)

    expect(
      findTokenImpersonation(
        { chainId: BUILT_IN_CHAIN_ID.Polygon, address: USDC, symbol: 'USDC', name: 'x' },
        polygon,
      ),
    ).not.toBeNull()
  })
})
