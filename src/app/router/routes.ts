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
  Admin: '/admin',
  AdminSendings: '/admin/sendings',
  EmailManager: '/email-manager',

  /* Чему приходится доверять, пользуясь кошельком в браузере. Открыт
     до создания кошелька: сведения нужны раньше решения. */
  Trust: '/trust',
  Privacy: '/privacy',
  Terms: '/terms',

  /* Экраны разблокированного кошелька. Делят общую оболочку с навигацией. */
  Dashboard: '/wallet',
  Send: '/wallet/send',
  Assets: '/wallet/assets',
  Portfolio: '/wallet/portfolio',
  Connections: '/wallet/connections',
  Nft: '/wallet/nft',
  Activity: '/wallet/activity',
  Settings: '/wallet/settings',
  Approvals: '/wallet/approvals',
  Backup: '/wallet/backup',

  /* Неподвижные этюды темы главного экрана. Открыты без разблокировки:
     это сравнение вида, а не кабинет. */
  Variant1: '/variant-1',
  Variant2: '/variant-2',
  Variant3: '/variant-3',
} as const

export type Route = (typeof ROUTE)[keyof typeof ROUTE]
