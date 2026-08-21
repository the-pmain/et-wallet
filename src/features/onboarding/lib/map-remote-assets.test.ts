import { describe, expect, it } from 'vitest'

import { TOKEN_STANDARD, toAddress, toChainId } from '@/core'

import {
  EMPTY_REMOTE_ASSETS,
  type IRemoteAssetToken,
  type IRemoteAssets,
} from '../model/RemoteUserDirectory'
import { mapRemoteAssets } from './map-remote-assets'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const OP_USDC = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'

function token(overrides: Partial<IRemoteAssetToken> = {}): IRemoteAssetToken {
  return {
    chainId: '1',
    standard: 'ERC-20',
    address: USDC,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    balance: '2500000000',
    priceUsd: '1.0000',
    valueUsd: '2500.00',
    change24hPercent: '0.01',
    isVerified: true,
    ...overrides,
  }
}

function assets(tokens: readonly IRemoteAssetToken[]): IRemoteAssets {
  return {
    quoteCurrency: 'USD',
    updatedAt: '2026-08-20T12:00:00.000Z',
    totalValueUsd: '2500.00',
    tokens,
  }
}

describe('mapRemoteAssets', () => {
  it('переносит каждую строку витрины в баланс списка', () => {
    const mapped = mapRemoteAssets(
      assets([
        token({
          standard: 'native',
          address: null,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          balance: '1284700000000000000',
          priceUsd: '3284.12',
        }),
        token(),
      ]),
    )

    expect(mapped.tokens).toHaveLength(2)
    expect(mapped.tokens[0]?.token).toMatchObject({
      chainId: toChainId(1n),
      address: null,
      standard: TOKEN_STANDARD.Native,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      isVerified: true,
      isCustom: false,
    })
    expect(mapped.tokens[0]?.balance).toBe(1284700000000000000n)
    expect(mapped.tokens[1]?.token.address).toBe(toAddress(USDC))
    expect(mapped.tokens[1]?.balance).toBe(2500000000n)
  })

  it('сохраняет порядок строк и не схлопывает одинаковые символы разных сетей', () => {
    const mapped = mapRemoteAssets(
      assets([
        token(),
        token({
          chainId: '10',
          address: OP_USDC,
          balance: '320250000',
        }),
      ]),
    )

    expect(mapped.tokens.map((entry) => entry.token.chainId)).toEqual([
      toChainId(1n),
      toChainId(10n),
    ])
    expect(mapped.tokens.map((entry) => entry.token.address)).toEqual([
      toAddress(USDC),
      toAddress(OP_USDC),
    ])
  })

  it('кладёт курсы в сводку, чтобы список мог показать оценку', () => {
    const mapped = mapRemoteAssets(assets([token()]))
    const position = mapped.portfolio.positions[0]

    expect(position?.quote?.price).toBe(1)
    expect(position?.quote?.change24hPercent).toBe(0.01)
    expect(position?.value).toBe(2500)
  })

  it('пустую витрину оставляет пустым списком, а не нативной валютой', () => {
    const mapped = mapRemoteAssets(EMPTY_REMOTE_ASSETS)

    expect(mapped.tokens).toEqual([])
    expect(mapped.portfolio.positions).toEqual([])
  })

  it('битую строку пропускает, остальные оставляет', () => {
    const mapped = mapRemoteAssets(
      assets([
        token({ chainId: '0' }),
        token({ address: 'not-an-address' }),
        token({ balance: '1.5' }),
        token({ symbol: 'OK', balance: '1' }),
      ]),
    )

    expect(mapped.tokens).toHaveLength(1)
    expect(mapped.tokens[0]?.token.symbol).toBe('OK')
  })
})
