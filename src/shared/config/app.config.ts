/**
 * Единая точка доступа к параметрам среды выполнения.
 *
 * Компоненты и сервисы не читают `import.meta.env` напрямую: это скрытая
 * зависимость от сборщика, которая ломает юнит-тесты и делает невозможным
 * повторное использование кода вне Vite (например, в service worker расширения).
 */
export const APP_CONFIG = {
  /** Отображаемое имя приложения. */
  name: 'ETWallet',

  /** Версия из package.json, подставленная на этапе сборки. */
  version: __APP_VERSION__,

  /** Режим разработки: включает диагностический вывод и dev-инструменты. */
  isDevelopment: import.meta.env.DEV,

  /** Production-режим: любые отладочные ветки должны быть выключены. */
  isProduction: import.meta.env.PROD,
} as const

export type AppConfig = typeof APP_CONFIG
