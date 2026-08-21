import { describe, expect, it } from 'vitest'

import {
  STARTING_TOKENS,
  STORED_ASSET_FIELD_NAMES,
  STORED_TOKEN_FIELD_NAMES,
  createStartingAssets,
  emptyAssets,
  parseAssets,
  readAssetsPayload,
  sanitizeAssets,
  withZeroTokenBalances,
  type IUserAssets,
} from './assets.ts'

const ETH_HOLDING = {
  quoteCurrency: 'USD' as const,
  updatedAt: '2026-08-20T12:00:00.000Z',
  tokens: [
    {
      chainId: '1',
      standard: 'native' as const,
      address: null,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      balance: '100000000000000000',
      isVerified: true,
    },
  ],
}

describe('assets', () => {
  it('пустой ввод даёт пустую витрину', () => {
    expect(parseAssets(null)).toEqual(emptyAssets())
    expect(parseAssets(undefined)).toEqual(emptyAssets())
    expect(parseAssets([])).toEqual(emptyAssets())
  })

  it('принимает витрину из остатков без оценки', () => {
    expect(parseAssets(ETH_HOLDING)).toEqual(ETH_HOLDING)
  })

  it('игнорирует устаревшие поля оценки', () => {
    expect(
      parseAssets({
        ...ETH_HOLDING,
        totalValueUsd: '14790.76',
        tokens: [
          {
            ...ETH_HOLDING.tokens[0],
            priceUsd: '3284.12',
            valueUsd: '328.41',
            change24hPercent: '1.84',
          },
        ],
      }),
    ).toEqual(ETH_HOLDING)
  })

  it('отвергает тело без валюты и списка', () => {
    expect(readAssetsPayload(undefined)).toBeNull()
    expect(readAssetsPayload({ quoteCurrency: 'EUR' })).toBeNull()
    expect(readAssetsPayload({ ...ETH_HOLDING, tokens: [{ symbol: 'ETH' }] })).toBeNull()
  })

  it('стартовая витрина — нулевые остатки и только хранимые поля', () => {
    const assets = createStartingAssets(new Date('2026-08-21T00:00:00.000Z'))
    const serialized = JSON.stringify(assets)

    expect(assets).toEqual({
      quoteCurrency: 'USD',
      updatedAt: '2026-08-21T00:00:00.000Z',
      tokens: STARTING_TOKENS,
    })
    expect(assets.tokens).toHaveLength(1)
    expect(assets.tokens[0]).toMatchObject({
      chainId: '1',
      standard: 'native',
      address: null,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      balance: '0',
      isVerified: true,
    })
    expect(Object.keys(assets).sort()).toEqual([...STORED_ASSET_FIELD_NAMES].sort())
    expect(serialized).not.toMatch(/priceUsd|valueUsd|totalValueUsd|change24hPercent/u)

    for (const token of assets.tokens) {
      expect(token.balance).toBe('0')
      expect(Object.keys(token).sort()).toEqual([...STORED_TOKEN_FIELD_NAMES].sort())
      expect(token).not.toHaveProperty('priceUsd')
      expect(token).not.toHaveProperty('valueUsd')
      expect(token).not.toHaveProperty('change24hPercent')
    }
  })

  it('sanitizeAssets вырезает оценку из старой записи', () => {
    const dirty = {
      quoteCurrency: 'USD',
      updatedAt: '2026-08-21T00:00:00.000Z',
      totalValueUsd: '14790.76',
      tokens: [
        {
          chainId: '1',
          standard: 'native',
          address: null,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          balance: '0',
          isVerified: true,
          priceUsd: '3284.12',
          valueUsd: '0',
          change24hPercent: '1.84',
        },
      ],
    }

    const cleaned = sanitizeAssets(dirty as IUserAssets)

    expect(cleaned).not.toHaveProperty('totalValueUsd')
    expect(cleaned.tokens[0]).toEqual({
      chainId: '1',
      standard: 'native',
      address: null,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      balance: '0',
      isVerified: true,
    })
    expect(JSON.stringify(cleaned)).not.toMatch(/priceUsd|valueUsd|totalValueUsd|change24hPercent/u)
  })

  it('withZeroTokenBalances обнуляет любой пришедший остаток', () => {
    const zeroed = withZeroTokenBalances({
      quoteCurrency: 'USD',
      updatedAt: '2026-08-21T00:00:00.000Z',
      tokens: [
        {
          ...STARTING_TOKENS[0]!,
          balance: '1284700000000000000',
        },
      ],
    })

    expect(zeroed.tokens[0]?.balance).toBe('0')
  })
})
