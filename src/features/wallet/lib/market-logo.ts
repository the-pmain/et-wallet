import type { ITokenLogo } from './token-logo'

/**
 * Marks of known market coins from our own build.
 *
 * The CoinGecko response image is not used. CSP blocks foreign
 * images, and the set of requested files would tell the host which
 * coins were viewed and tie that to an IP.
 *
 * The key is the CoinGecko id, not the ticker: `ETH` can mean
 * anything, `ethereum` is a catalog entry. A mark is granted only
 * when the file is in the build. Others get a monogram.
 */
const LOGO_BASE = '/logos'

const DARK_VARIANTS: Readonly<Record<string, string>> = {
  eth: 'eth-on-dark',
}

const LOGO_BY_COINGECKO_ID: Readonly<Record<string, string>> = {
  bitcoin: 'btc',
  ethereum: 'eth',
  tether: 'usdt',
  'usd-coin': 'usdc',
  binancecoin: 'bnb',
  dai: 'dai',
  'avalanche-2': 'avax',
  'matic-network': 'pol',
  'polygon-ecosystem-token': 'pol',
  'wrapped-bitcoin': 'btc',
}

function logo(name: string): ITokenLogo {
  const dark = DARK_VARIANTS[name]

  return {
    src: `${LOGO_BASE}/${name}.svg`,
    srcOnDark: dark === undefined ? null : `${LOGO_BASE}/${dark}.svg`,
  }
}

/** Market-coin mark. `null` means the file is not in the build. */
export function findMarketLogo(coinId: string): ITokenLogo | null {
  const name = LOGO_BY_COINGECKO_ID[coinId]

  return name === undefined ? null : logo(name)
}
