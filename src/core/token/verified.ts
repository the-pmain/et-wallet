import { toAddress } from '@/core/address'
import { BUILT_IN_CHAIN_ID } from '@/core/network'
import type { Address, ChainId } from '@/core/types'

/**
 * Встроенный список проверенных контрактов.
 *
 * ЗАЧЕМ ОН НУЖЕН. Символ и имя токена задаёт автор контракта: выпустить
 * токен с обозначением `USDC` может кто угодно, и в списке активов он
 * будет выглядеть настоящим. Единственное, что отличает подделку
 * от оригинала, — адрес контракта, а сверять сорок два символа глазами
 * человек не станет. Список переносит эту сверку в кошелёк.
 *
 * ЧТО ОЗНАЧАЕТ ПОМЕТКА. Только одно: адрес совпал с известным.
 * Она не обещает, что проект надёжен, что токен чего-то стоит и что
 * с ним ничего не случится. Обещать это кошелёк не может.
 *
 * ЗНАЧЕНИЯ ИЗМЕРЕНЫ, А НЕ ВПИСАНЫ ПО ПАМЯТИ. Каждый адрес опрошен
 * живым узлом: прочитаны `symbol`, `name` и `decimals`. Проверка
 * окупилась сразу — по памяти список содержал бы неверные значения:
 *
 * - на Polygon мост Tether отвечает символом `USDT0`, а не `USDT`;
 * - на Arbitrum — `USD₮0` с типографским знаком тенге;
 * - на Avalanche — `USDt` со строчной буквой;
 * - на BNB Chain у USDT и USDC ВОСЕМНАДЦАТЬ знаков, а не шесть,
 *   как в Ethereum. Ошибка здесь исказила бы сумму в триллион раз.
 *
 * СПИСОК НЕБОЛЬШОЙ СОЗНАТЕЛЬНО. Он содержит то, что реально проверено
 * и с чем работает большинство: стейблкоины и обёрнутые валюты сетей.
 * Раздувать его сотнями адресов «по спискам из интернета» значит
 * поручиться за то, чего никто не сверял.
 */

/** Проверенный контракт: адрес и то, чем он ответил при опросе. */
export interface IVerifiedToken {
  readonly chainId: ChainId

  readonly address: Address

  /** Символ, прочитанный из контракта. */
  readonly symbol: string

  /** Имя, прочитанное из контракта. */
  readonly name: string

  /** Число знаков, прочитанное из контракта. */
  readonly decimals: number
}

/* Дата опроса контрактов: 3 августа 2026. Значения могут устареть —
   контракт с обновляемой реализацией вправе изменить символ, как это
   уже произошло с мостом Tether. Расхождение кошелёк показывает,
   а не прячет: см. `TokenService.add`. */
const VERIFIED: readonly IVerifiedToken[] = [
  /* --- Ethereum --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F'),
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Ethereum,
    address: toAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
  },

  /* --- Optimism --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Optimism,
    address: toAddress('0x4200000000000000000000000000000000000006'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- BNB Chain. Здесь у стейблкоинов восемнадцать знаков. --- */
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0x55d398326f99059fF775485246999027B3197955'),
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 18,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.BnbChain,
    address: toAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    symbol: 'WBNB',
    name: 'Wrapped BNB',
    decimals: 18,
  },

  /* --- Polygon --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
    symbol: 'USDT0',
    name: 'USDT0',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Polygon,
    address: toAddress('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Base --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Base,
    address: toAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Base,
    address: toAddress('0x4200000000000000000000000000000000000006'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Arbitrum --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'),
    symbol: 'USD₮0',
    name: 'USD₮0',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Arbitrum,
    address: toAddress('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },

  /* --- Avalanche --- */
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'),
    symbol: 'USDt',
    name: 'TetherToken',
    decimals: 6,
  },
  {
    chainId: BUILT_IN_CHAIN_ID.Avalanche,
    address: toAddress('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'),
    symbol: 'WAVAX',
    name: 'Wrapped AVAX',
    decimals: 18,
  },
]

/**
 * Поиск по паре «сеть плюс адрес».
 *
 * Ключ в нижнем регистре: адрес приходит и с контрольной суммой,
 * и без неё, а контракт различается байтами, а не написанием.
 */
const BY_KEY = new Map(
  VERIFIED.map((token) => [`${token.chainId.toString()}:${token.address.toLowerCase()}`, token]),
)

/** Проверенные контракты сети. Порядок совпадает с объявленным. */
export function listVerifiedTokens(chainId: ChainId): readonly IVerifiedToken[] {
  return VERIFIED.filter((token) => token.chainId === chainId)
}

/**
 * Проверенный контракт по адресу.
 *
 * `null` означает «в списке нет», а не «подделка»: список заведомо
 * неполон, и подавляющее большинство законных токенов в него не входит.
 */
export function findVerifiedToken(chainId: ChainId, address: Address): IVerifiedToken | null {
  return BY_KEY.get(`${chainId.toString()}:${address.toLowerCase()}`) ?? null
}

/** Есть ли адрес в списке проверенных. */
export function isVerifiedToken(chainId: ChainId, address: Address): boolean {
  return findVerifiedToken(chainId, address) !== null
}
