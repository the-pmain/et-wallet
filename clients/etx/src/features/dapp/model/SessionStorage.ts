import { STORAGE_NAMESPACE, toStorageKey, type ISecureStorage, type ILogger } from '@/core'

/**
 * Хранилище, каким его ожидает библиотека WalletConnect.
 *
 * Описано у нас, а не взято из пакета: тянуть зависимость ради пяти
 * сигнатур незачем, а зависимость в кошельке — это ещё один путь
 * к секретам.
 */
export interface IKeyValueStorage {
  getKeys(): Promise<string[]>
  getEntries<TValue = unknown>(): Promise<[string, TValue][]>
  getItem<TValue = unknown>(key: string): Promise<TValue | undefined>
  setItem<TValue = unknown>(key: string, value: TValue): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Хранилище подключений поверх зашифрованного.
 *
 * ЗАЧЕМ ОНО. Не затем, зачем предполагалось. Установленная версия
 * библиотеки заводит собственную базу IndexedDB и переносит в неё
 * прежние записи из `localStorage`; сессии, вопреки записи в списке
 * долга, перезагрузку переживают. Проверено чтением поставляемого
 * пакета, а не по памяти.
 *
 * Настоящих же неисправностей три, и все три эта замена устраняет.
 *
 * ПЕРВАЯ: ЗАПИСИ ЛЕЖАТ ОТКРЫТЫМ ТЕКСТОМ. Они содержат симметричные
 * ключи, которыми шифруется обмен с приложением через relay.
 * Получивший их читает переписку кошелька с приложением и может выдать
 * себя за кошелёк. Здесь они читаются только при снятой блокировке.
 *
 * ВТОРАЯ: ОНИ ПЕРЕЖИВАЮТ УДАЛЕНИЕ КОШЕЛЬКА. База принадлежит
 * библиотеке, наше удаление её не касается, и новый кошелёк на том же
 * устройстве наследовал бы чужие подключения. Здесь они исчезают
 * вместе с кошельком, потому что лежат в его хранилище.
 *
 * ТРЕТЬЯ: ОНИ ВНЕ НАШЕГО УЧЁТА. Смена пароля перешифровывает всё, что
 * принадлежит кошельку; чужая база остаётся как была.
 *
 * ЦЕНА ЗАМЕНЫ НАЗВАНА ПРЯМО: подключения теперь доступны только при
 * снятой блокировке. Для раздела, который и работает лишь в открытом
 * кошельке, это ничего не меняет, но при автоблокировке во время
 * работы запись отказывает — см. долг.
 *
 * ЗАБЛОКИРОВАННОЕ ХРАНИЛИЩЕ НЕ ЗАМАЛЧИВАЕТСЯ ПРИ ЗАПИСИ И ЗАМАЛЧИВАЕТСЯ
 * ПРИ ЧТЕНИИ. Отказ записи означает потерю сессии — о нём библиотека
 * обязана узнать. Отказ чтения при блокировке означает лишь «сейчас
 * недоступно», и пустой ответ здесь честнее исключения: библиотека
 * начнёт с чистого состояния, а не сломается.
 */
export class SecureSessionStorage implements IKeyValueStorage {
  readonly #storage: ISecureStorage
  readonly #logger: ILogger

  constructor(storage: ISecureStorage, logger: ILogger) {
    this.#storage = storage
    this.#logger = logger.child('SessionStorage')
  }

  async getKeys(): Promise<string[]> {
    if (!this.#storage.isUnlocked) {
      return []
    }

    return [...(await this.#storage.keys(STORAGE_NAMESPACE.DappSessions))]
  }

  async getEntries<TValue = unknown>(): Promise<[string, TValue][]> {
    const entries: [string, TValue][] = []

    for (const key of await this.getKeys()) {
      const value = await this.getItem<TValue>(key)

      /* Ключ без значения пропускается, а не отдаётся с `undefined`:
         библиотека ожидает пары, и пара с пустым значением ломает
         её разбор состояния. */
      if (value !== undefined) {
        entries.push([key, value])
      }
    }

    return entries
  }

  async getItem<TValue = unknown>(key: string): Promise<TValue | undefined> {
    if (!this.#storage.isUnlocked) {
      return undefined
    }

    try {
      const value = await this.#storage.get<TValue>(
        STORAGE_NAMESPACE.DappSessions,
        toStorageKey(key),
      )

      /* Отсутствие записи библиотека ожидает как `undefined`,
         а хранилище отдаёт `null`. */
      return value ?? undefined
    } catch (error) {
      /* Испорченная запись не должна лишать работоспособности весь
         раздел: подключение будет установлено заново. */
      this.#logger.warn('A connection record could not be read', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return undefined
    }
  }

  async setItem<TValue = unknown>(key: string, value: TValue): Promise<void> {
    /* Исключение наружу: молча потерянная запись означает подключение,
       которое не переживёт перезагрузку, — ровно та неисправность,
       ради которой это хранилище и написано. */
    await this.#storage.set(STORAGE_NAMESPACE.DappSessions, toStorageKey(key), value)
  }

  async removeItem(key: string): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.DappSessions, toStorageKey(key))
  }
}
