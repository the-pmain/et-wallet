import { SecretBufferWipedError } from '@/core/errors'

import { wipeBytes } from './random'
import type { ISecretBuffer } from './types'

/** Значение, подставляемое вместо секрета при попытке его сериализовать. */
const REDACTED = '[SECRET]'

/**
 * Владение секретом в оперативной памяти.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Тип `string` непригоден для хранения секретов: строки
 * в JavaScript иммутабельны и интернируются движком, поэтому затереть их
 * содержимое невозможно — оно остаётся в куче до сборки мусора, момент
 * которой не контролируется. `Uint8Array` затирается явно.
 *
 * ЧЕГО ЭТОТ КЛАСС НЕ ДАЁТ. Затирание сокращает окно присутствия секрета
 * в памяти, но не устраняет риск: V8 использует перемещающий сборщик мусора
 * и вправе скопировать буфер, оставив прежнюю копию в освобождённой странице.
 * Защитой от дампа памяти процесса это не является, и обещать обратное было бы
 * обманом.
 *
 * ЗАЩИТА ОТ СЛУЧАЙНОЙ УТЕЧКИ. Переопределены `toString` и `toJSON`.
 * Без них секрет попадает в журнал при подстановке в шаблонную строку
 * и в отладочный дамп при `JSON.stringify` состояния приложения — два самых
 * частых способа непреднамеренно раскрыть ключ.
 *
 * ПРАВИЛА ИСПОЛЬЗОВАНИЯ:
 * - вызывать `wipe()` в блоке `finally` сразу после использования;
 * - не сохранять в состоянии UI и не передавать между слоями дольше,
 *   чем требуется для одной операции;
 * - не создавать копий `bytes` без последующего затирания копии.
 */
export class SecretBuffer implements ISecretBuffer {
  #bytes: Uint8Array | null

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  /**
   * Принимает владение переданным массивом.
   *
   * Вызывающий обязан больше не использовать исходную ссылку: `wipe()`
   * затрёт именно её содержимое.
   */
  static own(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(bytes)
  }

  /**
   * Создаёт независимую копию.
   *
   * Нужен, когда исходный массив принадлежит другому владельцу и будет
   * затёрт им самостоятельно.
   */
  static copyOf(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(Uint8Array.from(bytes))
  }

  /**
   * Переводит текст в буфер.
   *
   * ВНИМАНИЕ: исходная строка остаётся в куче и затиранию не подлежит.
   * Метод не устраняет утечку, а ограничивает её одним значением — тем,
   * которое уже было создано вызывающим кодом.
   */
  static fromUtf8(text: string): SecretBuffer {
    return new SecretBuffer(new TextEncoder().encode(text))
  }

  /** Выделяет нулевой буфер заданного размера. */
  static allocate(size: number): SecretBuffer {
    return new SecretBuffer(new Uint8Array(size))
  }

  /**
   * Содержимое буфера.
   *
   * @throws SecretBufferWipedError если буфер уже затёрт. Исключение,
   *         а не пустой массив: молчаливый возврат нулей привёл бы
   *         к выводу ключа из пустого секрета.
   */
  get bytes(): Uint8Array {
    if (this.#bytes === null) {
      throw new SecretBufferWipedError()
    }

    return this.#bytes
  }

  get isWiped(): boolean {
    return this.#bytes === null
  }

  /** Размер в байтах. Доступен и после затирания — секретом не является. */
  get byteLength(): number {
    return this.#bytes?.length ?? 0
  }

  /**
   * Затирает содержимое нулями и помечает буфер недействительным.
   * Повторный вызов безопасен.
   */
  wipe(): void {
    if (this.#bytes === null) {
      return
    }

    wipeBytes(this.#bytes)
    this.#bytes = null
  }

  /** Не раскрывает содержимое при подстановке в строку. */
  toString(): string {
    return REDACTED
  }

  /** Не раскрывает содержимое при JSON.stringify. */
  toJSON(): string {
    return REDACTED
  }
}
