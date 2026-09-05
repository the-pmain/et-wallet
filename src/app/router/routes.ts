/**
 * Screen addresses.
 *
 * Collected in one place so a navigation is not a string literal in
 * every handler: a typo in such a string is not a build error, it is
 * a silent trip to a screen that does not exist.
 */
export const ROUTE = {
  Welcome: '/',
  Create: '/create',
  Import: '/import',
  Unlock: '/unlock',
  ForgotPassword: '/forgot-password',
  Admin: '/admin',
  AdminSendings: '/admin/sendings',

  /* What you have to trust when using a wallet in the browser. Open
     before wallet creation: the facts are needed before the decision. */
  Trust: '/trust',
  Privacy: '/privacy',
  Terms: '/terms',

  /* Unlocked-wallet screens. They share a shell with navigation. */
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

  /* Static studies of the home-screen theme. Open without unlock:
     this is a look comparison, not the cabinet. */
  Variant1: '/variant-1',
  Variant2: '/variant-2',
  Variant3: '/variant-3',
} as const

export type Route = (typeof ROUTE)[keyof typeof ROUTE]
