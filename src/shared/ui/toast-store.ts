/** Оттенок тоста. Совпадает с уровнями предупреждений остального интерфейса. */
export const TOAST_TONE = {
  Neutral: 'neutral',
  Success: 'success',
  Warning: 'warning',
  Danger: 'danger',
} as const

export type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE]

/** Показанное уведомление. */
export interface IToast {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

/**
 * Сколько тост держится на экране.
 *
 * Достаточно, чтобы прочесть строку, и не настолько долго, чтобы копиться
 * на экране. Пользователь может закрыть раньше.
 */
export const TOAST_DURATION_MS = 4000

/**
 * Хранилище тостов в модуле, а не в контексте.
 *
 * ПОЧЕМУ ТАК. Показать уведомление нужно из мест, у которых нет доступа
 * к дереву компонентов, — из обработчика, из сервиса. Модульная функция
 * `toast()` вызывается откуда угодно, а `<Toaster />` лишь отображает
 * то, что в хранилище.
 *
 * ОТДЕЛЬНЫЙ ФАЙЛ ОТ КОМПОНЕНТА. Горячая перезагрузка React работает
 * верно только когда модуль экспортирует одни компоненты; хранилище
 * и функция живут здесь, а `Toaster` — рядом.
 */
let toasts: readonly IToast[] = []
const listeners = new Set<() => void>()
let nextId = 0

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Убирает уведомление по идентификатору. */
export function dismissToast(id: number): void {
  toasts = toasts.filter((entry) => entry.id !== id)
  emit()
}

/**
 * Показывает уведомление в правом верхнем углу.
 *
 * @returns Идентификатор — на случай, если уведомление нужно убрать
 *          раньше срока.
 */
export function toast(message: string, tone: ToastTone = TOAST_TONE.Neutral): number {
  const id = nextId
  nextId += 1

  toasts = [...toasts, { id, message, tone }]
  emit()

  return id
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function getToasts(): readonly IToast[] {
  return toasts
}
