import { BUILT_IN_CHAIN_ID, findVerifiedToken, type Address, type ChainId } from '@/core'

/**
 * Знаки монет, вложенные в сборку.
 *
 * ФАЙЛАМИ, А НЕ ВСТРОЕННОЙ РАЗМЕТКОЙ. Знаки нарисованы разными
 * редакторами и содержат внутренние классы вроде `.st0`. Встроенные
 * в одну страницу, они переопределяли бы друг друга: у двух знаков
 * `.st0` — разные цвета. Отдельный файл — отдельный документ,
 * и столкновения невозможны.
 *
 * ЗАПРОС УХОДИТ К СВОЕМУ ЖЕ ПРОИСХОЖДЕНИЮ. Боевая политика
 * безопасности разрешает `img-src 'self' data: blob:`, и файл из
 * собственной сборки ей отвечает. Стороннее хранилище логотипов было
 * бы заблокировано браузером — и правильно: по набору запрошенных
 * картинок его оператор узнал бы состав портфеля владельца и связал
 * бы его с IP-адресом.
 */
const LOGO_BASE = '/logos'

/** Знак монеты: основной файл и, если нужен, вариант для тёмной темы. */
export interface ITokenLogo {
  readonly src: string

  /**
   * Вариант для тёмной темы. `null` — знак читается на обеих.
   *
   * Нужен там, где официальный знак одноцветный и тёмный: ромб эфира
   * нарисован серыми тонами от `#141414` и на тёмном фоне пропадает.
   * Светлый вариант получен инверсией светлоты, то есть соотношение
   * граней сохранено — это тот же знак, а не другой рисунок.
   */
  readonly srcOnDark: string | null
}

/** Монеты, чей знак не читается на тёмном фоне. */
const DARK_VARIANTS: Readonly<Record<string, string>> = {
  eth: 'eth-on-dark',
}

function logo(name: string): ITokenLogo {
  const dark = DARK_VARIANTS[name]

  return {
    src: `${LOGO_BASE}/${name}.svg`,
    srcOnDark: dark === undefined ? null : `${LOGO_BASE}/${dark}.svg`,
  }
}

/**
 * Знак по обозначению ПРОВЕРЕННОГО токена.
 *
 * Ключ — обозначение из встроенного реестра, а не из контракта:
 * реестр заполняется вручную и сверен с живым узлом, тогда как
 * обозначение в контракте пишет его автор.
 *
 * Обёрнутые версии носят знак исходного актива: WETH — знак эфира,
 * WBTC — биткоина. Это не упрощение, а правда о содержимом: обёртка
 * представляет ровно этот актив в отношении один к одному.
 */
const LOGO_BY_VERIFIED_SYMBOL: Readonly<Record<string, string>> = {
  USDC: 'usdc',
  USDT: 'usdt',
  USDT0: 'usdt',
  USDt: 'usdt',
  'USD₮': 'usdt',
  DAI: 'dai',
  WETH: 'eth',
  WBTC: 'btc',
  WBNB: 'bnb',
  WAVAX: 'avax',
}

/** Знак нативной валюты сети. У неё нет адреса контракта. */
const LOGO_BY_CHAIN: ReadonlyMap<ChainId, string> = new Map([
  [BUILT_IN_CHAIN_ID.Ethereum, 'eth'],
  [BUILT_IN_CHAIN_ID.Optimism, 'eth'],
  [BUILT_IN_CHAIN_ID.Arbitrum, 'eth'],
  [BUILT_IN_CHAIN_ID.Base, 'eth'],
  [BUILT_IN_CHAIN_ID.BnbChain, 'bnb'],
  [BUILT_IN_CHAIN_ID.Polygon, 'pol'],
  [BUILT_IN_CHAIN_ID.Avalanche, 'avax'],
])

/**
 * Находит знак монеты. `null` — знака нет, рисуется отпечаток адреса.
 *
 * ЗНАК ПОЛАГАЕТСЯ ТОЛЬКО ПРОВЕРЕННОМУ КОНТРАКТУ, И ЭТО ГЛАВНОЕ ЗДЕСЬ.
 *
 * Выпустить контракт с обозначением `USDC` может кто угодно и почти
 * бесплатно. Знак, выданный по обозначению, добавил бы подделке ровно
 * ту убедительность, которой ей не хватает, — и работал бы против
 * владельца средств.
 *
 * Ключом служит адрес контракта: он проходит через встроенный реестр,
 * и обозначение берётся оттуда, а не из контракта. Поэтому настоящий
 * USDC получает знак, а поддельный с тем же обозначением — прежний
 * цветной кружок. Разница видна с одного взгляда, тогда как прежде
 * оба выглядели одинаково и различались лишь пометкой рядом.
 *
 * То есть знак здесь не украшение, а ещё один признак подлинности.
 */
export function findTokenLogo(chainId: ChainId | null, address: Address | null): ITokenLogo | null {
  if (chainId === null) {
    return null
  }

  if (address === null) {
    const native = LOGO_BY_CHAIN.get(chainId)

    return native === undefined ? null : logo(native)
  }

  const verified = findVerifiedToken(chainId, address)

  if (verified === null) {
    return null
  }

  const name = LOGO_BY_VERIFIED_SYMBOL[verified.symbol]

  return name === undefined ? null : logo(name)
}
