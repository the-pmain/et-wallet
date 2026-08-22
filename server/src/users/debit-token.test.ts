import { describe, expect, it } from 'vitest'

import { ASSET_STANDARD, type IAssetToken, type IUserAssets } from './assets.ts'
import {
  debitToken,
  findTokenBySymbol,
  subtractTokenBalance,
  toTokenUnits,
} from './debit-token.ts'

const ETH: IAssetToken = {
  chainId: '1',
  standard: ASSET_STANDARD.Native,
  address: null,
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  balance: '41000000000000000',
  isVerified: true,
}

const USDC_ETH: IAssetToken = {
  chainId: '1',
  standard: ASSET_STANDARD.Erc20,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  balance: '8000000',
  isVerified: true,
}

const USDC_OP: IAssetToken = {
  chainId: '10',
  standard: ASSET_STANDARD.Erc20,
  address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  balance: '4000000',
  isVerified: true,
}

const ASSETS: IUserAssets = {
  quoteCurrency: 'USD',
  updatedAt: '2026-08-20T12:00:00.000Z',
  tokens: [ETH, USDC_ETH, USDC_OP],
}

describe('debit-token', () => {
  it('переводит человеческую сумму в минимальные единицы', () => {
    expect(toTokenUnits('0.041', 18)).toBe(41000000000000000n)
    expect(toTokenUnits('4', 6)).toBe(4000000n)
    expect(toTokenUnits('0.01', 18)).toBe(10000000000000000n)
  })

  it('отвергает дробь длиннее decimals', () => {
    expect(toTokenUnits('1.2345678', 6)).toBeNull()
  })

  it('берёт Ethereum, если тикер есть в нескольких сетях', () => {
    expect(findTokenBySymbol(ASSETS.tokens, 'usdc')).toEqual(USDC_ETH)
    expect(findTokenBySymbol(ASSETS.tokens, 'WETH')).toBeNull()
  })

  it('списывает сумму и не уходит ниже нуля', () => {
    const next = debitToken(ASSETS, ETH, 10000000000000000n, new Date('2026-08-22T16:00:00.000Z'))

    expect(next.updatedAt).toBe('2026-08-22T16:00:00.000Z')
    expect(next.tokens[0]?.balance).toBe('31000000000000000')
    expect(next.tokens[1]?.balance).toBe('8000000')
    expect(subtractTokenBalance('100', 400n)).toBe('0')
  })
})
