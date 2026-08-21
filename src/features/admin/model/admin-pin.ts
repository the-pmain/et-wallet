/**
 * PIN кабинета администратора в `localStorage`.
 *
 * После успешной сверки с сервером сюда пишется предъявленное значение.
 * Следующий заход на `/admin` или `/email-manager` не спрашивает PIN
 * заново: сервер всё равно сверяет заголовок на каждом запросе.
 */

export const ADMIN_PIN_STORAGE_KEY = 'etwallet.admin-pin'

/** Читает сохранённый PIN. Повреждённая запись считается отсутствием. */
export function readAdminPin(): string | null {
  try {
    const raw = localStorage.getItem(ADMIN_PIN_STORAGE_KEY)

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
export function writeAdminPin(pin: string): void {
  try {
    localStorage.setItem(ADMIN_PIN_STORAGE_KEY, pin)
  } catch {
    /* Нет квоты — сессия этой вкладки всё равно открыта. */
  }
}

/** Стирает сохранённый PIN. */
export function clearAdminPin(): void {
  try {
    localStorage.removeItem(ADMIN_PIN_STORAGE_KEY)
  } catch {
    /* Нет хранилища — нечего стирать. */
  }
}
