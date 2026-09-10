import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/core'

/**
 * Готова ли пара полей «пароль» и «подтверждение» к отправке.
 *
 * Сложности нет: достаточно непустого пароля в пределах длины
 * и совпадения с подтверждением.
 */
export function isPasswordPairValid(password: string, confirmation: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    password === confirmation
  )
}
