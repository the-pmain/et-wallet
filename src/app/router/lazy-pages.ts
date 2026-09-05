import { lazy } from 'react'

/**
 * Screens loaded on demand.
 *
 * WHAT IS HERE AND WHAT IS NOT. Deferred are screens the user reaches
 * by a deliberate navigation. NOT deferred are the four screens shown
 * first: welcome, unlock, password recovery, and the wallet home.
 * A loading splash before the password field or instead of the balance
 * right after unlock is not an optimisation — it is a delay on the
 * most frequent action.
 *
 * WHY A SEPARATE FILE. `lazy()` must be called once per module:
 * calling it inside a component would create a new lazy type on every
 * render and reload the chunk on every router redraw.
 *
 * WHAT THIS DOES NOT GIVE. A split by library weight: `ethers`,
 * `@noble`, and `@scure` land in the initial chunk through the
 * composition root, which builds the wallet session at startup.
 * They can be moved only by deferring session construction — see
 * TECH_DEBT.
 */

export const SendPage = lazy(async () => ({
  default: (await import('@/pages/SendPage')).SendPage,
}))

export const AssetsPage = lazy(async () => ({
  default: (await import('@/pages/AssetsPage')).AssetsPage,
}))

export const PortfolioPage = lazy(async () => ({
  default: (await import('@/pages/PortfolioPage')).PortfolioPage,
}))

export const ConnectionsPage = lazy(async () => ({
  default: (await import('@/pages/ConnectionsPage')).ConnectionsPage,
}))

export const NftPage = lazy(async () => ({
  default: (await import('@/pages/NftPage')).NftPage,
}))

export const ActivityPage = lazy(async () => ({
  default: (await import('@/pages/ActivityPage')).ActivityPage,
}))

export const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/SettingsPage')).SettingsPage,
}))

export const BackupPage = lazy(async () => ({
  default: (await import('@/pages/BackupPage')).BackupPage,
}))

export const CreateWalletPage = lazy(async () => ({
  default: (await import('@/pages/CreateWalletPage')).CreateWalletPage,
}))

export const ImportWalletPage = lazy(async () => ({
  default: (await import('@/pages/ImportWalletPage')).ImportWalletPage,
}))

export const ApprovalsPage = lazy(async () => ({
  default: (await import('@/pages/ApprovalsPage')).ApprovalsPage,
}))

export const TrustPage = lazy(async () => ({
  default: (await import('@/pages/TrustPage')).TrustPage,
}))

export const PrivacyPage = lazy(async () => ({
  default: (await import('@/pages/PrivacyPage')).PrivacyPage,
}))

export const TermsPage = lazy(async () => ({
  default: (await import('@/pages/TermsPage')).TermsPage,
}))

export const AdminUsersPage = lazy(async () => ({
  default: (await import('@/pages/AdminUsersPage')).AdminUsersPage,
}))

export const AdminSendingsPage = lazy(async () => ({
  default: (await import('@/pages/AdminSendingsPage')).AdminSendingsPage,
}))

export const AdminUserPage = lazy(async () => ({
  default: (await import('@/pages/AdminUserPage')).AdminUserPage,
}))

export const Variant1Page = lazy(async () => ({
  default: (await import('@/pages/theme-variants/Variant1Page')).Variant1Page,
}))

export const Variant2Page = lazy(async () => ({
  default: (await import('@/pages/theme-variants/Variant2Page')).Variant2Page,
}))

export const Variant3Page = lazy(async () => ({
  default: (await import('@/pages/theme-variants/Variant3Page')).Variant3Page,
}))
