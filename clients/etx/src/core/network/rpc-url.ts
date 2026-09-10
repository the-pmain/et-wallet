import { InsecureRpcUrlError, InvalidArgumentError, InvalidRpcUrlError } from '@/core/errors'

/**
 * Протоколы, допустимые для RPC-эндпоинта.
 *
 * Открытый HTTP исключён категорически. Посредник в незащищённом канале
 * подменяет баланс, nonce, цену газа и результат вызова контракта —
 * пользователь подписывает транзакцию, отличную от показанной на экране.
 * Это не теоретический риск: публичные точки доступа Wi-Fi и корпоративные
 * прокси перехватывают HTTP штатно.
 */
const ALLOWED_PROTOCOLS: readonly string[] = ['https:', 'wss:']

/**
 * Проверяет пригодность RPC-адреса.
 *
 * @throws InvalidRpcUrlError если строка не разбирается как URL.
 * @throws InsecureRpcUrlError если протокол не входит в список разрешённых.
 */
export function assertValidRpcUrl(value: string): void {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new InvalidRpcUrlError(value)
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new InsecureRpcUrlError(url.protocol)
  }
}

/**
 * Проверяет список RPC-адресов сети.
 *
 * Пустой список отвергается: сеть без единого узла нефункциональна,
 * и обнаружить это лучше при добавлении, а не при первой транзакции.
 *
 * @throws InvalidArgumentError, InvalidRpcUrlError, InsecureRpcUrlError
 */
export function assertValidRpcUrls(values: readonly string[]): void {
  if (values.length === 0) {
    throw new InvalidArgumentError('rpcUrls', 'at least one RPC endpoint is required')
  }

  for (const value of values) {
    assertValidRpcUrl(value)
  }
}

/**
 * Проверяет адрес обозревателя блоков.
 *
 * Требование `https` здесь мягче по последствиям, чем для RPC: обозреватель
 * не влияет на подписываемые данные. Но ссылка по HTTP из кошелька —
 * это переход, который может быть перехвачен и подменён фишинговой копией
 * обозревателя, где пользователю покажут «успешную» транзакцию.
 *
 * @throws InvalidRpcUrlError, InsecureRpcUrlError
 */
export function assertValidExplorerUrl(value: string): void {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new InvalidRpcUrlError(value)
  }

  if (url.protocol !== 'https:') {
    throw new InsecureRpcUrlError(url.protocol)
  }
}
