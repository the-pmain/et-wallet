import { assessPassword } from '@/core'

/**
 * Готова ли пара полей «пароль» и «подтверждение» к отправке.
 *
 * Вынесена из компонента: React Fast Refresh корректно работает только
 * когда модуль экспортирует исключительно компоненты, а соседство
 * компонента и обычной функции приводит к полной перезагрузке страницы
 * при каждой правке.
 *
 * Правила берутся из ядра: качество пароля — доменное решение,
 * а не особенность интерфейса.
 */
export function isPasswordPairValid(password: string, confirmation: string): boolean {
  return assessPassword(password).isAcceptable && password === confirmation
}
