import type { ILogger } from '@/core/platform'
import type { IProvider } from '@/core/provider'
import type { Address } from '@/core/types'

/**
 * Поиск адресов, которыми уже пользовались.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Кошелёк, восстановленный по seed-фразе, создаёт один
 * аккаунт — первый по счёту. У человека, у которого их было пять,
 * четыре просто не появятся: адреса выводятся из фразы, но кошелёк
 * о них не знает, пока не выведет. Владелец видит вместо своих средств
 * пустой кошелёк и разумно заключает, что средства пропали. Это худший
 * из возможных первых экранов после восстановления.
 *
 * КАК ОПРЕДЕЛЯЕТСЯ «ПОЛЬЗОВАЛИСЬ». Двумя признаками, и оба нужны:
 *
 * - число отправленных транзакций больше нуля — с адреса что-то
 *   отправляли;
 * - баланс больше нуля — на адресе что-то лежит.
 *
 * Ни один по отдельности не достаточен: адрес, на который только
 * присылали, имеет нулевой счётчик, а адрес, с которого всё вывели,
 * имеет нулевой баланс.
 *
 * ЧЕГО ЭТОТ ПОИСК НЕ НАХОДИТ. Адрес, где нет ни отправок, ни нативной
 * валюты, но лежат токены либо предметы. Чтобы увидеть их, пришлось бы
 * опрашивать каждый контракт по каждому адресу — десятки запросов
 * на адрес вместо двух. Ограничение названо прямо в интерфейсе: молчать
 * о нём значило бы снова обещать полноту, которой нет.
 *
 * ПРОМЕЖУТОК В ДВАДЦАТЬ АДРЕСОВ — это правило BIP-44, а не догадка.
 * Кошельки пропускают адреса при создании, поэтому поиск не
 * останавливается на первом пустом: он продолжается, пока подряд
 * не встретится двадцать неиспользованных.
 *
 * ЦЕНА ПРИВАТНОСТИ. Поиск сообщает оператору узла два десятка адресов
 * разом и связывает их между собой. Это ровно то, что кошелёк обычно
 * старается не делать, и потому поиск не идёт сам по себе при каждом
 * запуске: он выполняется один раз после восстановления либо по прямой
 * просьбе владельца.
 */

/** Промежуток пустых адресов, после которого поиск прекращается. */
export const DEFAULT_GAP_LIMIT = 20

/**
 * Предел числа проверяемых адресов.
 *
 * Защита от бесконечного обхода, если узел ошибочно сообщает активность
 * по любому адресу. Двести — заведомо больше, чем бывает у человека,
 * и всё ещё конечно.
 */
export const MAX_SCANNED_ADDRESSES = 200

/** Настройки поиска. */
export interface IDiscoveryOptions {
  readonly gapLimit?: number
  readonly maxScanned?: number
}

/** Итог поиска. */
export interface IDiscoveryResult {
  /** Индексы адресов, которыми пользовались. Всегда по возрастанию. */
  readonly usedIndexes: readonly number[]

  /** Сколько адресов проверено. Нужно, чтобы честно назвать глубину. */
  readonly scanned: number

  /**
   * Поиск прекращён из-за предела, а не из-за промежутка.
   *
   * Значит, дальше могли остаться занятые адреса, и говорить
   * «это все ваши аккаунты» нельзя.
   */
  readonly stoppedByLimit: boolean
}

/** Как получить адрес по порядковому номеру. */
export type AddressAt = (addressIndex: number) => Address

/**
 * Ищет адреса, которыми пользовались.
 *
 * ОТКАЗ УЗЛА ПРЕРЫВАЕТ ПОИСК, А НЕ ПРОПУСКАЕТ АДРЕС. Пропуск означал бы,
 * что занятый адрес молча не попал в результат — то самое, против чего
 * весь этот поиск и написан. Найденное до отказа возвращается: оно
 * проверено.
 */
export async function discoverUsedAccounts(
  provider: IProvider,
  addressAt: AddressAt,
  logger: ILogger,
  options: IDiscoveryOptions = {},
): Promise<IDiscoveryResult> {
  const gapLimit = options.gapLimit ?? DEFAULT_GAP_LIMIT
  const maxScanned = options.maxScanned ?? MAX_SCANNED_ADDRESSES

  const usedIndexes: number[] = []

  let emptyInRow = 0
  let scanned = 0

  while (emptyInRow < gapLimit && scanned < maxScanned) {
    const addressIndex = scanned
    const address = addressAt(addressIndex)

    let isUsed: boolean

    try {
      isUsed = await hasActivity(provider, address)
    } catch (error) {
      logger.warn('Address discovery stopped: the node did not answer', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return { usedIndexes, scanned, stoppedByLimit: false }
    }

    scanned += 1

    if (isUsed) {
      usedIndexes.push(addressIndex)
      emptyInRow = 0
    } else {
      emptyInRow += 1
    }
  }

  return { usedIndexes, scanned, stoppedByLimit: scanned >= maxScanned }
}

/**
 * Пользовались ли адресом.
 *
 * Оба запроса уходят разом: они независимы, а последовательные удвоили
 * бы время поиска на медленном узле.
 */
async function hasActivity(provider: IProvider, address: Address): Promise<boolean> {
  const [nonce, balance] = await Promise.all([
    provider.getTransactionCount(address),
    provider.getBalance(address),
  ])

  return nonce > 0 || balance > 0n
}
