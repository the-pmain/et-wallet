import type { ITokenLogo } from './token-logo'

/**
 * Знаки известных монет рынка из собственной сборки.
 *
 * КАРТИНКА ИЗ ОТВЕТА COINGECKO СЮДА НЕ БЕРЁТСЯ. Политика безопасности
 * режет чужие изображения, а по набору запрошенных файлов оператор
 * хранилища узнал бы, какие монеты смотрели, и связал бы это с IP.
 *
 * Ключ — идентификатор CoinGecko, а не тикер: `ETH` может значить
 * что угодно, `ethereum` — конкретная запись каталога. Знак выдаётся
 * только монетам, чей файл лежит в сборке. Остальные получают монограмму.
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

/** Знак рыночной монеты. `null` — файла в сборке нет. */
export function findMarketLogo(coinId: string): ITokenLogo | null {
  const name = LOGO_BY_COINGECKO_ID[coinId]

  return name === undefined ? null : logo(name)
}
