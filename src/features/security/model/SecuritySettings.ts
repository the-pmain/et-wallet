import { SETTINGS_KEY, STORAGE_NAMESPACE, type IStorageService } from '@/core'

/**
 * Допустимые сроки автоблокировки.
 *
 * Список закрытый, а не произвольное число: поле ввода позволило бы
 * назначить сутки и превратить защиту в её видимость. Значения выбраны
 * так, чтобы самый длинный оставался осмысленным.
 */
export const AUTO_LOCK_OPTIONS: readonly number[] = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
]

/** Срок по умолчанию: пятнадцать минут. */
export const DEFAULT_AUTO_LOCK_MS = 15 * 60_000

/** Настройки безопасности, хранимые между сессиями. */
export interface ISecuritySettings {
  readonly autoLockTimeoutMs: number

  /** Требовать пароль перед подписью транзакции. */
  readonly confirmBeforeSigning: boolean
}

/** Значения по умолчанию. Применяются, пока пользователь не выбрал своё. */
export const DEFAULT_SECURITY_SETTINGS: ISecuritySettings = {
  autoLockTimeoutMs: DEFAULT_AUTO_LOCK_MS,
  confirmBeforeSigning: true,
}

/**
 * Чтение и запись настроек безопасности.
 *
 * ХРАНЯТСЯ В НЕЗАШИФРОВАННОМ ХРАНИЛИЩЕ СОЗНАТЕЛЬНО. Срок автоблокировки
 * нужен до разблокировки — иначе кошелёк не знал бы, через сколько
 * блокироваться, пока пользователь не ввёл пароль. Секрета эти значения
 * не составляют: знание о том, что блокировка наступает через пятнадцать
 * минут, ничего не даёт нападающему, у которого нет пароля.
 *
 * НЕПОНЯТНОЕ ЗНАЧЕНИЕ ЗАМЕНЯЕТСЯ УМОЛЧАНИЕМ, А НЕ ПРИНИМАЕТСЯ.
 * Испорченная запись — например, отрицательный срок — иначе отключила
 * бы автоблокировку насовсем.
 */
export class SecuritySettingsRepository {
  readonly #storage: IStorageService

  constructor(storage: IStorageService) {
    this.#storage = storage
  }

  async read(): Promise<ISecuritySettings> {
    const [timeout, confirm] = await Promise.all([
      this.#storage.get<number>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.AutoLockTimeoutMs),
      this.#storage.get<boolean>(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.ConfirmBeforeSigning),
    ])

    return {
      autoLockTimeoutMs: isAllowedTimeout(timeout) ? timeout : DEFAULT_AUTO_LOCK_MS,
      /* Отсутствие записи означает «включено»: защита, выключенная
         по умолчанию, защитой не является. */
      confirmBeforeSigning: confirm !== false,
    }
  }

  async setAutoLockTimeout(timeoutMs: number): Promise<void> {
    if (!isAllowedTimeout(timeoutMs)) {
      throw new Error('Недопустимый срок автоблокировки.')
    }

    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.AutoLockTimeoutMs, timeoutMs)
  }

  async setConfirmBeforeSigning(enabled: boolean): Promise<void> {
    await this.#storage.set(STORAGE_NAMESPACE.Settings, SETTINGS_KEY.ConfirmBeforeSigning, enabled)
  }
}

/** Входит ли срок в список допустимых. */
function isAllowedTimeout(value: number | null): value is number {
  return value !== null && AUTO_LOCK_OPTIONS.includes(value)
}
