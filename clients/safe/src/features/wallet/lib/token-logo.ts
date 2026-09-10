import { BUILT_IN_CHAIN_ID, findVerifiedToken, type Address, type ChainId } from '@/core'

/**
 * Coin marks bundled with the build.
 *
 * Files, not inlined markup. Marks from different editors share
 * internal classes like `.st0` with different colors; inlined on one
 * page they would override each other. A separate file is a separate
 * document, so collisions cannot happen.
 *
 * The request goes to our own origin. Production CSP allows
 * `img-src 'self' data: blob:`. A third-party logo host would be
 * blocked — correctly: the set of requested images would reveal the
 * owner's portfolio and tie it to an IP.
 */
const LOGO_BASE = '/logos'

/** Coin mark: primary file and, if needed, a dark-theme variant. */
export interface ITokenLogo {
  readonly src: string

  /**
   * Dark-theme variant. `null` means the mark reads on both.
   *
   * Needed when the official mark is monochrome and dark: Ethereum's
   * diamond is painted in greys from `#141414` and vanishes on a dark
   * background. The light variant is a lightness invert, so the facet
   * ratios stay — the same mark, not a different drawing.
   */
  readonly srcOnDark: string | null
}

/** Coins whose mark does not read on a dark background. */
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
 * Mark keyed by a VERIFIED token's ticker.
 *
 * The key is the built-in registry symbol, not the contract's: the
 * registry is filled by hand and checked against a live node, while
 * the contract symbol is written by its author.
 *
 * Wrapped versions wear the underlying mark: WETH is ether, WBTC is
 * bitcoin. That is the content, not a shortcut — the wrap is 1:1.
 */
const LOGO_BY_VERIFIED_SYMBOL: Readonly<Record<string, string>> = {
  USDC: 'usdc',
  USDT: 'usdt',
  USDT0: 'usdt',
  USDt: 'usdt',
  'USD₮': 'usdt',
  'USD₮0': 'usdt',
  DAI: 'dai',
  WETH: 'eth',
  WBTC: 'btc',
  WBNB: 'bnb',
  WAVAX: 'avax',
}

/** Native-currency mark for a chain. It has no contract address. */
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
 * Find a coin mark. `null` means none — the address fingerprint is drawn.
 *
 * A mark is granted only to a verified contract. Anyone can mint a
 * `USDC` ticker almost for free. A mark keyed by ticker would give a
 * fake the credibility it lacks. The key is the contract address,
 * looked up in the built-in registry; the symbol is taken from there.
 * Real USDC gets the mark; a fake with the same ticker keeps the
 * colored circle. The mark is another authenticity signal, not
 * decoration.
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
