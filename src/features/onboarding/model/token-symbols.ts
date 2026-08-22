/**
 * Тикеры из витрины `users.assets.tokens`.
 *
 * То же множество, что на сервере в `server/src/users/token-symbols.ts`:
 * кабинет и запись перевода выбирают из одного списка.
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
