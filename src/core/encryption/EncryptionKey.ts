import { SecretBufferWipedError } from '@/core/errors'

/**
 * Сессионный ключ шифрования.
 *
 * Непрозрачная обёртка над `CryptoKey` Web Crypto API. Существует
 * по трём причинам:
 *
 * 1. **Ключ не покидает Web Crypto.** Он создаётся с `extractable: false`,
 *    поэтому выгрузить байты ключа из JavaScript невозможно в принципе —
 *    ни отладчиком, ни через `JSON.stringify`, ни при дампе состояния.
 *    Это сильнее любого затирания буфера.
 *
 * 2. **Тип `CryptoKey` не протекает в доменные контракты.** Домен не должен
 *    знать, что под ним Web Crypto: замена реализации не должна затрагивать
 *    интерфейсы.
 *
 * 3. **Явная точка уничтожения.** `destroy()` отмечает ключ недействительным,
 *    и дальнейшие операции с ним отвергаются.
 *
 * ГРАНИЦА ГАРАНТИИ. `destroy()` отпускает ссылку, но не затирает материал
 * ключа: JavaScript такой возможности не даёт, а хранит ключ реализация
 * браузера вне кучи JS. Ключ исчезает при сборке мусора, момент которой
 * не контролируется. Обещать большее было бы обманом.
 */
export class EncryptionKey {
  #key: CryptoKey | null

  private constructor(key: CryptoKey) {
    this.#key = key
  }

  /**
   * Оборачивает выведенный ключ.
   *
   * @internal Вызывается только из `EncryptionService`.
   */
  static wrap(key: CryptoKey): EncryptionKey {
    return new EncryptionKey(key)
  }

  /** Уничтожен ли ключ. */
  get isDestroyed(): boolean {
    return this.#key === null
  }

  /**
   * Материал ключа для операций Web Crypto.
   *
   * @internal Используется только реализацией шифрования.
   * @throws SecretBufferWipedError если ключ уже уничтожен.
   */
  unwrap(): CryptoKey {
    if (this.#key === null) {
      throw new SecretBufferWipedError()
    }

    return this.#key
  }

  /** Отмечает ключ недействительным. Повторный вызов безопасен. */
  destroy(): void {
    this.#key = null
  }

  /** Не раскрывает состояние при подстановке в строку. */
  toString(): string {
    return '[EncryptionKey]'
  }

  /** Не раскрывает состояние при сериализации состояния приложения. */
  toJSON(): string {
    return '[EncryptionKey]'
  }
}
