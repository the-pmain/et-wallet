/**
 * Снимок публичного рынка.
 *
 * ЭТО НЕ КУРС ПОРТФЕЛЯ. Список не содержит адресов владельца и адресов
 * его контрактов: сервис узнаёт только IP и то, что кто-то смотрел
 * общедоступную таблицу. Поэтому запрос не требует согласия, которое
 * берётся на экране портфеля — там в запросе уходят адреса активов.
 *
 * КАРТИНКА ИЗ ОТВЕТА СЮДА НЕ ПОПАДАЕТ. Боевой CSP разрешает изображения
 * только из собственной сборки; чужой URL в `src` был бы заблокирован,
 * а набор запрошенных картинок выдал бы оператору хранилища, какие
 * монеты смотрели. Знаки, если нужны, берутся из вложенных файлов.
 */
export interface IMarketCoin {
  readonly id: string
  readonly symbol: string
  readonly name: string
  readonly rank: number
  readonly priceUsd: number | null
  readonly change1hPercent: number | null
  readonly change24hPercent: number | null
  readonly change7dPercent: number | null
  readonly volume24hUsd: number | null
  readonly marketCapUsd: number | null
}

/**
 * Разбирает ответ `/coins/markets`.
 *
 * ЗАПИСЬ БЕЗ ИМЕНИ ОТБРАСЫВАЕТСЯ, А НЕ ЧИНИТСЯ. Подставить прочерк
 * вместо имени значило бы показать строку, которую нельзя опознать.
 * Битая запись среди пятидесяти не отменяет остальные: одна дыра
 * в ответе — не повод прятать весь рынок.
 */
export function parseMarketList(payload: unknown): readonly IMarketCoin[] {
  if (!Array.isArray(payload)) {
    throw new Error('The price source returned an unexpected response.')
  }

  const coins: IMarketCoin[] = []

  for (const [index, entry] of payload.entries()) {
    const coin = readMarketCoin(entry, index)

    if (coin !== null) {
      coins.push(coin)
    }
  }

  return coins
}

/** Собирает одну строку рынка. `null` — запись нельзя показать. */
function readMarketCoin(entry: unknown, index: number): IMarketCoin | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }

  const record = entry as Record<string, unknown>
  const id = readRequiredString(record['id'])
  const name = readRequiredString(record['name'])
  const symbol = readRequiredString(record['symbol'])

  if (id === null || name === null || symbol === null) {
    return null
  }

  const rank = readRank(record['market_cap_rank'], index)

  return {
    id,
    name,
    symbol: symbol.toUpperCase(),
    rank,
    priceUsd: readNumber(record['current_price']),
    change1hPercent: readNumber(record['price_change_percentage_1h_in_currency']),
    change24hPercent: readNumber(record['price_change_percentage_24h_in_currency']),
    change7dPercent: readNumber(record['price_change_percentage_7d_in_currency']),
    volume24hUsd: readNumber(record['total_volume']),
    marketCapUsd: readNumber(record['market_cap']),
  }
}

/** Положительный ранг из ответа, иначе порядковый номер в выдаче. */
function readRank(value: unknown, index: number): number {
  const rank = readNumber(value)

  if (rank === null || rank <= 0) {
    return index + 1
  }

  return Math.trunc(rank)
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

/**
 * Конечное число либо `null`.
 *
 * Ноль оставляется нулём: у стейблкоина изменение 0.0 % — настоящее
 * значение, а не дыра. Нечисло и бесконечность — дыра.
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
