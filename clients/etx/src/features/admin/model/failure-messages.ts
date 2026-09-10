/**
 * Готовые причины отказа в правке sending.
 *
 * Это подписи для кабинета, не коды сети. Свободный текст остаётся:
 * пункт Custom открывает поле, если ни одна заготовка не подходит.
 */
export const FAILURE_MESSAGE_NONE = ''
export const FAILURE_MESSAGE_CUSTOM = '__custom__'

export const FAILURE_MESSAGE_PRESETS = [
  'Blocked by admin',
  'Insufficient balance',
  'Recipient address rejected',
  'Token is not supported on this network',
  'Daily sending limit exceeded',
  'Held for compliance review',
  'Network rejected the transfer',
] as const

export type FailureMessagePreset = (typeof FAILURE_MESSAGE_PRESETS)[number]

/** Значение `<select>`: пусто, заготовка или Custom. */
export function failureMessageSelectValue(message: string | null | undefined): string {
  if (message === undefined || message === null || message === '') {
    return FAILURE_MESSAGE_NONE
  }

  return (FAILURE_MESSAGE_PRESETS as readonly string[]).includes(message)
    ? message
    : FAILURE_MESSAGE_CUSTOM
}

export function isCustomFailureMessage(message: string | null | undefined): boolean {
  return failureMessageSelectValue(message) === FAILURE_MESSAGE_CUSTOM
}
