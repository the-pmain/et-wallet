/**
 * Tickers from the `users.assets.tokens` showcase.
 *
 * One set for transfer create and the cabinet: otherwise
 * `sendings.symbol` and the `tokens` holding would drift apart.
 */
export const TOKEN_SYMBOL = {
  ETH: 'ETH',
  USDC: 'USDC',
  USDT: 'USDT',
  DAI: 'DAI',
  WBTC: 'WBTC',
  WETH: 'WETH',
} as const

export const TOKEN_SYMBOLS = [
  TOKEN_SYMBOL.ETH,
  TOKEN_SYMBOL.USDC,
  TOKEN_SYMBOL.USDT,
  TOKEN_SYMBOL.DAI,
  TOKEN_SYMBOL.WBTC,
  TOKEN_SYMBOL.WETH,
] as const

export type TokenSymbol = (typeof TOKEN_SYMBOLS)[number]

export function isKnownTokenSymbol(value: string): value is TokenSymbol {
  return (TOKEN_SYMBOLS as readonly string[]).includes(value.trim().toUpperCase())
}
