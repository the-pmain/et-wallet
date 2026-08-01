import type { ITokenEntry } from './types.ts'

/**
 * Каталог рекомендуемых токенов.
 *
 * КАК СЮДА ПОПАДАЕТ ЗАПИСЬ. Адрес обязан подтвердиться двумя
 * независимыми источниками:
 *
 * 1. опубликованным списком токенов (Uniswap Labs Default, версия 22.6.0);
 * 2. живым контрактом в сети: `symbol()`, `name()` и `decimals()`
 *    запрашиваются у узла и сверяются со списком.
 *
 * РАСХОЖДЕНИЕ ИСТОЧНИКОВ — ПОВОД ИСКЛЮЧИТЬ ЗАПИСЬ, А НЕ ВЫБРАТЬ ОДИН
 * ИЗ ВАРИАНТОВ. Так из каталога выпал USDT в сети Polygon
 * (`0xc2132D05D31c914a87C6611C10748AEb04B58e8F`): список называет его
 * `USDT` / «Tether USD», а контракт при сверке ответил `USDT0`. Пока
 * причина расхождения не выяснена, рекомендовать этот адрес нельзя.
 *
 * ПОЧЕМУ АДРЕСА НЕ ВПИСЫВАЮТСЯ ПО ПАМЯТИ. Шестнадцатеричный адрес
 * непроверяем при чтении кода: ошибка в одном символе даёт другой
 * контракт, а рекомендованный кошельком адрес — это адрес, на который
 * пользователь отправит деньги. Перевод в блокчейне необратим.
 *
 * ПОЛЕ `provenance` ОТДАЁТСЯ КЛИЕНТУ. Признак «проверено» непроверяем,
 * происхождение — проверяемо. Пользователь вправе видеть, на чём
 * основана рекомендация, и решить сам, достаточно ли этого.
 *
 * СЕТИ BNB Chain И Avalanche ЗАПИСЕЙ НЕ ИМЕЮТ: они не покрыты
 * использованным списком, а сверять их по одному источнику — значит
 * не сверять вовсе. Пустой список для этих сетей означает «нет
 * подтверждённых рекомендаций», а не «токенов нет».
 */

/** Использованный список токенов и его версия. */
const TOKEN_LIST_SOURCE = 'Uniswap Labs Default 22.6.0'

/** Сверка с контрактами в сети. */
const ON_CHAIN_SOURCE = 'Сверка symbol/name/decimals с контрактом'

/** Дата сверки с контрактами. */
const VERIFIED_AT = '2026-07-31'

const PROVENANCE = [TOKEN_LIST_SOURCE, ON_CHAIN_SOURCE]

/** Собирает запись каталога, подставляя общие для всех записей поля. */
function token(
  chainId: bigint,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
): ITokenEntry {
  return {
    chainId,
    address,
    symbol,
    name,
    decimals,
    provenance: PROVENANCE,
    verifiedAt: VERIFIED_AT,
  }
}

export const TOKENS: readonly ITokenEntry[] = [
  /* Ethereum */
  token(1n, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6),
  token(1n, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6),
  token(1n, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai Stablecoin', 18),
  token(1n, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'WBTC', 'Wrapped BTC', 8),
  token(1n, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18),

  /* OP Mainnet */
  token(10n, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USD Coin', 6),
  token(10n, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6),
  token(10n, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18),
  token(10n, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),

  /* Polygon */
  token(137n, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USD Coin', 6),
  token(137n, '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 'DAI', '(PoS) Dai Stablecoin', 18),
  token(137n, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 'WETH', 'Wrapped Ether', 18),

  /* Base */
  token(8453n, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6),
  token(8453n, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 'DAI', 'Dai Stablecoin', 18),
  token(8453n, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),

  /* Arbitrum One */
  token(42161n, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USD Coin', 6),
  token(42161n, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18),
  token(42161n, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 'Wrapped Ether', 18),
]
