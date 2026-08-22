import { lazy } from 'react'

/**
 * Экраны, загружаемые по требованию.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО ЗДЕСЬ НЕТ. Отложены экраны, до которых
 * пользователь доходит осознанным переходом. НЕ отложены четыре экрана,
 * показываемые первыми: приветствие, разблокировка, восстановление
 * доступа и главный экран кошелька. Заставка загрузки перед полем пароля
 * либо вместо баланса сразу после разблокировки — не оптимизация,
 * а задержка на самом частом действии.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. `lazy()` обязан вызываться один раз на модуль:
 * вызов внутри компонента создавал бы новый ленивый тип на каждый рендер
 * и перезагружал бы чанк при каждой перерисовке маршрутизатора.
 *
 * ЧЕГО ЭТО НЕ ДАЁТ. Разделения по весу библиотек: `ethers`, `@noble`
 * и `@scure` попадают в начальный чанк через composition root, который
 * собирает сессию кошелька сразу при запуске. Вынести их можно только
 * отложенной сборкой сессии — см. TECH_DEBT.
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

export const AdminUsersPage = lazy(async () => ({
  default: (await import('@/pages/AdminUsersPage')).AdminUsersPage,
}))

export const AdminSendingsPage = lazy(async () => ({
  default: (await import('@/pages/AdminSendingsPage')).AdminSendingsPage,
}))

export const AdminUserPage = lazy(async () => ({
  default: (await import('@/pages/AdminUserPage')).AdminUserPage,
}))

