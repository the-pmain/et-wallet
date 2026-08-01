import type {
  IStorageEstimate,
  IStorageTransaction,
  StorageDurability,
  StorageKey,
  StorageNamespace,
} from './types'

/**
 * Постоянное хранилище приложения.
 *
 * Абстракция намеренно не упоминает IndexedDB. Реализация подменяется:
 * в веб-приложении это IndexedDB, в расширении manifest v3 — `chrome.storage`,
 * в тестах — реализация в памяти. Домен от выбора не зависит.
 *
 * Почему не localStorage (правило зафиксировано ещё на этапе 1 в виде
 * запрета ESLint):
 * - синхронен и блокирует главный поток;
 * - хранит только строки, поэтому бинарные секреты пришлось бы кодировать
 *   в неочищаемые JS-строки;
 * - доступен любому скрипту страницы и вычитывается при XSS одной строкой;
 * - недоступен в service worker manifest v3.
 *
 * Чего этот слой НЕ делает: он не шифрует. Шифрование выполняет вызывающий
 * код через `IEncryptionService` до записи. Иначе хранилище начнёт само
 * решать, что считать секретом, и граница ответственности размоется.
 *
 * ВАЖНО про сериализацию. Домен использует `bigint` для сумм и chainId,
 * а `JSON.stringify` на `bigint` выбрасывает исключение. Реализация обязана
 * применять кодек, сохраняющий `bigint` без потери точности. Приведение
 * к `number` недопустимо: оно молча портит суммы.
 */
export interface IStorageService {
  /** Открывает хранилище и выполняет непримененные миграции. */
  init(): Promise<void>

  get<TValue>(namespace: StorageNamespace, key: StorageKey): Promise<TValue | null>

  set<TValue>(namespace: StorageNamespace, key: StorageKey, value: TValue): Promise<void>

  remove(namespace: StorageNamespace, key: StorageKey): Promise<void>

  has(namespace: StorageNamespace, key: StorageKey): Promise<boolean>

  keys(namespace: StorageNamespace): Promise<readonly StorageKey[]>

  /** Очищает одно пространство имён. */
  clear(namespace: StorageNamespace): Promise<void>

  /**
   * Выполняет операции атомарно.
   *
   * Обязательна там, где несколько записей образуют одно логическое
   * изменение. Пример: добавление аккаунта меняет и зашифрованное хранилище
   * ключей, и список аккаунтов. Запись только одного из двух оставляет
   * кошелёк в противоречивом состоянии — аккаунт виден, но подписать им
   * ничего нельзя, либо ключ есть, а аккаунта нет.
   *
   * Исключение внутри `handler` откатывает всю транзакцию.
   */
  transaction<TResult>(
    namespaces: readonly StorageNamespace[],
    handler: (transaction: IStorageTransaction) => Promise<TResult>,
  ): Promise<TResult>

  /** Оценка занятого объёма. `null`, если браузер не предоставляет данные. */
  estimate(): Promise<IStorageEstimate | null>

  /**
   * Насколько надёжно хранилище удерживает данные.
   *
   * Реализация обязана отвечать честно: завышенная оценка означает,
   * что владелец не узнает о риске потерять кошелёк.
   */
  durability(): Promise<StorageDurability>

  /**
   * Полностью удаляет все данные приложения.
   *
   * Необратимая операция. Вызывающий код обязан получить явное подтверждение
   * пользователя и убедиться, что резервная копия seed-фразы существует.
   */
  destroy(): Promise<void>
}
