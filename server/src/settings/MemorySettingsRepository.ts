import { ConflictError } from '../lib/errors.ts'

import type { ISettingsRecord, ISettingsRepository } from './contracts.ts'

/** Настройки хранилища в памяти. */
export interface IMemorySettingsOptions {
  /** Через сколько миллисекунд запись без обращений исчезает. */
  readonly ttlMs: number

  /** Наибольшее число записей. Достигнув предела, хранилище отказывает. */
  readonly maxRecords: number

  /** Источник времени. Внедряется, чтобы срок жизни проверялся тестом. */
  readonly now: () => Date
}

/** Значения по умолчанию: тридцать суток и сто тысяч записей. */
const DEFAULT_OPTIONS: IMemorySettingsOptions = {
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  maxRecords: 100_000,
  now: () => new Date(),
}

/**
 * Хранилище настроек в памяти процесса.
 *
 * ЭТО НЕ ПОСТОЯННОЕ ХРАНИЛИЩЕ, И ЭТО ОСОЗНАННО. Перезапуск сервиса
 * стирает записи. Допустимо ровно потому, что синхронизация — зеркало:
 * настройки живут на устройстве, а сервис лишь помогает перенести их
 * на второе. Пользователь, потерявший запись здесь, ничего не теряет.
 *
 * Постоянное хранилище появится вместе с выбором СУБД; интерфейс
 * `ISettingsRepository` для этого и выделен. Заменять реализацию
 * придётся в одном месте — при сборке приложения.
 *
 * СРОК ЖИЗНИ ЗАПИСИ ОГРАНИЧЕН. Заброшенный шифротекст хранить вечно
 * незачем: он остаётся мишенью, ничем не помогая владельцу.
 */
export class MemorySettingsRepository implements ISettingsRepository {
  readonly #records = new Map<string, ISettingsRecord>()
  readonly #options: IMemorySettingsOptions

  constructor(options: Partial<IMemorySettingsOptions> = {}) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Число хранимых записей. Нужно наблюдению за сервисом. */
  get size(): number {
    return this.#records.size
  }

  get(syncId: string): Promise<ISettingsRecord | null> {
    const record = this.#records.get(syncId)

    if (record === undefined) {
      return Promise.resolve(null)
    }

    if (this.#isExpired(record)) {
      this.#records.delete(syncId)

      return Promise.resolve(null)
    }

    return Promise.resolve(record)
  }

  put(syncId: string, ciphertext: string, expectedRevision: number): Promise<ISettingsRecord> {
    const existing = this.#records.get(syncId)
    const current = existing !== undefined && !this.#isExpired(existing) ? existing : null

    /* Номер версии сверяется до записи: два устройства, писавшие
       одновременно, иначе затёрли бы изменения друг друга молча. */
    const currentRevision = current?.revision ?? 0

    if (expectedRevision !== currentRevision) {
      /* Отказ возвращается отклонённым обещанием, а не выбрасывается:
         синхронное исключение из метода, объявленного возвращающим
         `Promise`, приходит вызывающему коду по другому пути, и `catch`
         вокруг `await` его не поймает. */
      return Promise.reject(
        new ConflictError(
          `Настройки изменены другим устройством: ожидалась версия ${String(expectedRevision)}, ` +
            `в хранилище ${String(currentRevision)}.`,
        ),
      )
    }

    if (current === null && this.#records.size >= this.#options.maxRecords) {
      this.#collectExpired()

      if (this.#records.size >= this.#options.maxRecords) {
        return Promise.reject(new Error('Хранилище настроек заполнено.'))
      }
    }

    const record: ISettingsRecord = {
      ciphertext,
      revision: currentRevision + 1,
      updatedAt: this.#options.now(),
    }

    this.#records.set(syncId, record)

    return Promise.resolve(record)
  }

  remove(syncId: string): Promise<void> {
    this.#records.delete(syncId)

    return Promise.resolve()
  }

  #isExpired(record: ISettingsRecord): boolean {
    return this.#options.now().getTime() - record.updatedAt.getTime() > this.#options.ttlMs
  }

  /** Убирает записи с истёкшим сроком. */
  #collectExpired(): void {
    for (const [syncId, record] of this.#records) {
      if (this.#isExpired(record)) {
        this.#records.delete(syncId)
      }
    }
  }
}
