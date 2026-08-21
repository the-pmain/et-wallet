/**
 * PIN менеджера писем в `localStorage`.
 *
 * Отдельное поле от кабинета (`etwallet.admin-pin`): разблокировка
 * `/email-manager` не открывает `/admin` и наоборот.
 */

export const EMAIL_MANAGER_PIN_STORAGE_KEY = 'etwallet.email-manager-pin'

/** Читает сохранённый PIN. Повреждённая запись считается отсутствием. */
export function readEmailManagerPin(): string | null {
  try {
    const raw = localStorage.getItem(EMAIL_MANAGER_PIN_STORAGE_KEY)

    if (raw === null) {
      return null
    }

    const trimmed = raw.trim()

    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}

/** Пишет PIN после успешного ответа сервера. */
export function writeEmailManagerPin(pin: string): void {
  try {
    localStorage.setItem(EMAIL_MANAGER_PIN_STORAGE_KEY, pin)
  } catch {
    /* Нет квоты — сессия этой вкладки всё равно открыта. */
  }
}

/** Стирает сохранённый PIN. */
export function clearEmailManagerPin(): void {
  try {
    localStorage.removeItem(EMAIL_MANAGER_PIN_STORAGE_KEY)
  } catch {
    /* Нет хранилища — нечего стирать. */
  }
}
