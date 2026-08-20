import { MAX_PASSWORD_LENGTH, assessPassword } from '@/core'

/**
 * Готова ли пара полей «пароль» и «подтверждение» к отправке.
 *
 * Сложности нет: достаточно непустого пароля в пределах длины
 * и совпадения с подтверждением.
 */
export function isPasswordPairValid(password: string, confirmation: string): boolean {
  return (
    assessPassword(password).isAcceptable &&
    password.length <= MAX_PASSWORD_LENGTH &&
    password === confirmation
  )
}
