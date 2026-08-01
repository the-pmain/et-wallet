/**
 * Адреса экранов.
 *
 * Собраны в одном месте, чтобы переход не задавался строковым литералом
 * в каждом обработчике: опечатка в такой строке даёт не ошибку сборки,
 * а тихий переход на несуществующий экран.
 */
export const ROUTE = {
  Welcome: '/',
  Create: '/create',
  Import: '/import',
  Unlock: '/unlock',
  ForgotPassword: '/forgot-password',

  /* Экраны разблокированного кошелька. Делят общую оболочку с навигацией. */
  Dashboard: '/wallet',
  Send: '/wallet/send',
  Assets: '/wallet/assets',
  Portfolio: '/wallet/portfolio',
  Connections: '/wallet/connections',
  Nft: '/wallet/nft',
  Activity: '/wallet/activity',
  Settings: '/wallet/settings',
  Backup: '/wallet/backup',
} as const

export type Route = (typeof ROUTE)[keyof typeof ROUTE]
