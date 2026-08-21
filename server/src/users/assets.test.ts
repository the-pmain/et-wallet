import { describe, expect, it } from 'vitest'

import { emptyAssets, MOCK_USER_ASSETS, parseAssets, readAssetsPayload } from './assets.ts'

describe('assets', () => {
  it('пустой ввод даёт пустую витрину', () => {
    expect(parseAssets(null)).toEqual(emptyAssets())
    expect(parseAssets(undefined)).toEqual(emptyAssets())
    expect(parseAssets([])).toEqual(emptyAssets())
  })

  it('принимает витрину как у живого кошелька', () => {
    expect(parseAssets(MOCK_USER_ASSETS)).toEqual(MOCK_USER_ASSETS)
  })

  it('отвергает тело без пары валюты и суммы', () => {
    expect(readAssetsPayload(undefined)).toBeNull()
    expect(readAssetsPayload({ quoteCurrency: 'EUR' })).toBeNull()
    expect(readAssetsPayload({ ...MOCK_USER_ASSETS, tokens: [{ symbol: 'ETH' }] })).toBeNull()
  })

  it('в витрине есть ETH, стейблы и обёртки, без NFT', () => {
    const symbols = MOCK_USER_ASSETS.tokens.map((token) => token.symbol)

    expect(symbols).toContain('ETH')
    expect(symbols).toContain('USDC')
    expect(symbols).toContain('WBTC')
    expect(MOCK_USER_ASSETS.tokens[0]?.address).toBeNull()
    expect(MOCK_USER_ASSETS).not.toHaveProperty('nfts')
  })
})
