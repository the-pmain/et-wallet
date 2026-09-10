import { TooManyAttemptsError } from '@/core/errors'
import type { IClock, ILogger } from '@/core/platform'
import { SETTINGS_KEY, STORAGE_NAMESPACE, type IStorageService } from '@/core/storage'

const SERVICE_NAME = 'UnlockThrottle'

/**
 * Сколько попыток проходит без задержки.
 *
 * Три — запас на обычную опечатку и на раскладку клавиатуры. Меньше
 * означало бы наказывать за промах, больше — отдавать подбирающему
 * бесплатные попытки.
 */
const FREE_ATTEMPTS = 3

/**
 * Задержка после каждой следующей неудачи, в миллисекундах.
 *
 * Таблица, а не формула. Формула короче, но её значения приходится
 * вычислять в уме при чтении, а от них зависит, останется ли кошелёк
 * доступным владельцу. Рост близок к четырёхкратному: он быстро
 * обесценивает перебор и при этом не запирает человека, который просто
 * забыл раскладку.
 */
const DELAYS_MS: readonly number[] = [
  5_000, // 4-я попытка
  15_000, // 5-я
  60_000, // 6-я
  5 * 60_000, // 7-я
  15 * 60_000, // 8-я и далее
]

/** Состояние ограничителя, видимое интерфейсу. */
export interface IUnlockThrottleState {
  /** Неудачных попыток подряд. */
  readonly failedAttempts: number

  /**
   * Сколько миллисекунд осталось ждать. Ноль означает «ввод открыт».
   */
  readonly retryAfterMs: number
}

/** Запись состояния в хранилище. */
interface IThrottleRecord {
  readonly failedAttempts: number
  readonly blockedUntil: number | null
}

/** Пустое состояние. */
const EMPTY_STATE: IUnlockThrottleState = { failedAttempts: 0, retryAfterMs: 0 }

/** Зависимости ограничителя. */
export interface IUnlockThrottleDependencies {
  /**
   * НЕЗАШИФРОВАННОЕ хранилище.
   *
   * Иначе быть не может: ограничитель работает до разблокировки, когда
   * ключ дешифрования ещё не выведен.
   */
  readonly storage: IStorageService

  readonly clock: IClock
  readonly logger: ILogger
}

/**
 * Ограничитель попыток ввода пароля.
 *
 * ОТ ЧЕГО ЗАЩИЩАЕТ. От перебора паролей через интерфейс приложения:
 * человеком за оставленным устройством, вредоносным расширением,
 * сценарием на странице. Каждая следующая неудача обходится дороже
 * предыдущей, и перебор словаря становится бессмысленным.
 *
 * ОТ ЧЕГО НЕ ЗАЩИЩАЕТ, И ЭТО НУЖНО ПОНИМАТЬ. Тот, кто получил доступ
 * к диску, обнулит счётчик — он лежит в незашифрованных настройках,
 * потому что обязан читаться до разблокировки. Но такому противнику
 * ограничитель и не нужен: скопировав хранилище, он подбирает пароль
 * у себя, без нашего участия. Против этого работает единственное
 * средство — стойкость вывода ключа: 600 000 итераций PBKDF2 на каждую
 * пробу.
 *
 * СЧЁТЧИК ПЕРЕЖИВАЕТ ПЕРЕЗАГРУЗКУ. Ограничитель, обнуляемый обновлением
 * страницы, не ограничивает ничего: подбирающий нажимает F5 после каждой
 * неудачи. Это стало возможным только с появлением постоянного
 * хранилища.
 *
 * ВРЕМЯ БЕРЁТСЯ ИЗ ЧАСОВ, А НЕ ИЗ `Date.now()`. Перевод системных часов
 * назад — очевидный способ обойти ожидание, и он работает против любой
 * реализации на стороне клиента. Единый источник времени хотя бы делает
 * поведение проверяемым.
 */
export class UnlockThrottle {
  readonly #storage: IStorageService
  readonly #clock: IClock
  readonly #logger: ILogger

  constructor(dependencies: IUnlockThrottleDependencies) {
    this.#storage = dependencies.storage
    this.#clock = dependencies.clock
    this.#logger = dependencies.logger.child(SERVICE_NAME)
  }

  /**
   * Проверяет, открыт ли ввод.
   *
   * @throws TooManyAttemptsError с указанием оставшегося времени.
   */
  async assertAllowed(): Promise<void> {
    const { retryAfterMs } = await this.getState()

    if (retryAfterMs > 0) {
      throw new TooManyAttemptsError(retryAfterMs)
    }
  }

  /** Текущее состояние. Нужно интерфейсу для обратного отсчёта. */
  async getState(): Promise<IUnlockThrottleState> {
    const record = await this.#read()

    if (record === null) {
      return EMPTY_STATE
    }

    const remaining = record.blockedUntil === null ? 0 : record.blockedUntil - this.#clock.now()

    return {
      failedAttempts: record.failedAttempts,
      retryAfterMs: Math.max(0, remaining),
    }
  }

  /**
   * Отмечает неудачную попытку и назначает задержку.
   *
   * @returns Состояние после записи — чтобы вызывающий показал срок
   *          ожидания, не читая хранилище повторно.
   */
  async recordFailure(): Promise<IUnlockThrottleState> {
    const previous = await this.#read()
    const failedAttempts = (previous?.failedAttempts ?? 0) + 1
    const delayMs = delayFor(failedAttempts)

    const record: IThrottleRecord = {
      failedAttempts,
      blockedUntil: delayMs === 0 ? null : this.#clock.now() + delayMs,
    }

    await this.#write(record)

    if (delayMs > 0) {
      /* Пароль в журнал не попадает — только факт и срок: запись нужна,
         чтобы владелец мог заметить чужие попытки входа. */
      this.#logger.warn('Password entry is temporarily closed', {
        failedAttempts,
        delaySeconds: Math.round(delayMs / 1000),
      })
    }

    return { failedAttempts, retryAfterMs: delayMs }
  }

  /**
   * Отмечает успешный ввод.
   *
   * Счётчик обнуляется целиком: успешный пароль означает, что за
   * устройством владелец, и накопленное подозрение больше не относится
   * к делу.
   */
  async recordSuccess(): Promise<void> {
    await this.#storage.remove(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle)
  }

  /** Читает запись, отбрасывая испорченную. */
  async #read(): Promise<IThrottleRecord | null> {
    const stored = await this.#storage.get<unknown>(
      STORAGE_NAMESPACE.Settings,
      SETTINGS_KEY.UnlockThrottle,
    )

    if (typeof stored !== 'object' || stored === null) {
      return null
    }

    const record = stored as Record<string, unknown>
    const failedAttempts = record['failedAttempts']
    const blockedUntil = record['blockedUntil']

    if (typeof failedAttempts !== 'number' || !Number.isSafeInteger(failedAttempts)) {
      /* Испорченная запись трактуется как отсутствие ограничения, а не
         как вечная блокировка: иначе повреждение настроек запирало бы
         владельца в собственном кошельке навсегда. */
      this.#logger.warn('The throttle state was corrupted and has been reset')

      return null
    }

    return {
      failedAttempts,
      blockedUntil: typeof blockedUntil === 'number' ? blockedUntil : null,
    }
  }

  async #write(record: IThrottleRecord): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.UnlockThrottle, record)
  }
}

/**
 * Задержка после указанного числа неудач подряд.
 *
 * Экспортируется ради проверок и интерфейса: экран входа предупреждает
 * о приближении к порогу, и брать значения из второго места было бы
 * способом их рассогласовать.
 */
export function delayFor(failedAttempts: number): number {
  if (failedAttempts <= FREE_ATTEMPTS) {
    return 0
  }

  const index = Math.min(failedAttempts - FREE_ATTEMPTS - 1, DELAYS_MS.length - 1)

  return DELAYS_MS[index] ?? 0
}

/** Сколько попыток проходит без задержки. Нужно интерфейсу для подсказки. */
export const FREE_UNLOCK_ATTEMPTS = FREE_ATTEMPTS
