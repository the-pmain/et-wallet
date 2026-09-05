import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/core'

/**
 * Whether the password and confirmation pair is ready to submit.
 *
 * No complexity check: a non-empty password within the length bound
 * that matches confirmation is enough.
 */
export function isPasswordPairValid(password: string, confirmation: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    password === confirmation
  )
}
