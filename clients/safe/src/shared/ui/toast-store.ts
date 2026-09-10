/** Toast tone. Matches the warning levels of the rest of the UI. */
export const TOAST_TONE = {
  Neutral: 'neutral',
  Success: 'success',
  Warning: 'warning',
  Danger: 'danger',
} as const

export type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE]

export interface IToast {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

/**
 * How long a toast stays on screen.
 *
 * Long enough to read a line, not so long that they pile up.
 * The user can dismiss earlier.
 */
export const TOAST_DURATION_MS = 4000

/**
 * Toast store in a module, not in context.
 *
 * WHY. A toast must be shown from places with no access to the
 * component tree — a handler, a service. The module function
 * `toast()` is callable from anywhere; `<Toaster />` only renders
 * what is in the store.
 *
 * SEPARATE FILE FROM THE COMPONENT. React Fast Refresh works
 * correctly only when a module exports components alone; the store
 * and function live here, `Toaster` next door.
 */
let toasts: readonly IToast[] = []
const listeners = new Set<() => void>()
let nextId = 0

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((entry) => entry.id !== id)
  emit()
}

/**
 * Shows a toast in the top-right corner.
 *
 * @returns The id — in case the toast must be dismissed early.
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
