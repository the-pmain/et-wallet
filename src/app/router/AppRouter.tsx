import { Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'

import { ONBOARDING_STATE, useDirectorySession, useOnboardingState } from '@/features/onboarding'
/* Экраны входа импортируются модулями, а не через `@/pages`: сборный
   файл статически тянет за собой все страницы сразу и обесценил бы
   отложенную загрузку остальных. */
import { AdminPage } from '@/pages/AdminPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { EmailConversationPage } from '@/pages/EmailConversationPage'
import { EmailConversationsPage } from '@/pages/EmailConversationsPage'
import { EmailManagerPage } from '@/pages/EmailManagerPage'
import { EmailNewConversationPage } from '@/pages/EmailNewConversationPage'
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage'
import { UnlockWalletPage } from '@/pages/UnlockWalletPage'
import { WelcomePage } from '@/pages/WelcomePage'

import { TEST_MODE } from '@/shared/config'
import { Skeleton } from '@/shared/ui'

import { AppShell, AuthLayout } from '../layouts'
import {
  ActivityPage,
  ApprovalsPage,
  AssetsPage,
  BackupPage,
  ConnectionsPage,
  CreateWalletPage,
  ImportWalletPage,
  NftPage,
  PortfolioPage,
  SendPage,
  SettingsPage,
  TrustPage,
  AdminUsersPage,
  AdminSendingsPage,
  AdminUserPage,
} from './lazy-pages'
import { ROUTE } from './routes'

/**
 * Экран, соответствующий состоянию кошелька.
 *
 * Маршрутизация по состоянию, а не по свободному выбору пользователя:
 * заблокированный кошелёк не должен показывать экран создания, иначе
 * пользователь создаст второй кошелёк поверх первого и решит, что
 * средства пропали.
 */
function StateGate() {
  const state = useOnboardingState()
  const session = useDirectorySession()

  if (session.isRestoring) {
    return <Navigate to={ROUTE.Dashboard} replace />
  }

  if (session.user !== null) {
    return <Navigate to={ROUTE.Dashboard} replace />
  }

  switch (state) {
    case ONBOARDING_STATE.Loading:
      return <LoadingScreen />

    case ONBOARDING_STATE.Uninitialized:
      return <WelcomePage />

    case ONBOARDING_STATE.Locked:
      return <Navigate to={ROUTE.Unlock} replace />

    case ONBOARDING_STATE.Unlocked:
      return import.meta.env.MODE === 'test' ? (
        <Navigate to={ROUTE.Dashboard} replace />
      ) : (
        <Navigate to={ROUTE.Unlock} replace />
      )
  }
}

/**
 * Пропуск к экранам кошелька.
 *
 * Прямой переход по адресу `/wallet/settings` при заблокированном кошельке
 * обязан приводить к экрану пароля, а не к пустой оболочке: иначе
 * пользователь увидит части интерфейса, доступ к которым не подтверждал.
 *
 * ПРОВЕРКА СОСТОЯНИЯ ВЫПОЛНЯЕТСЯ ДО ЗАГРУЗКИ ЧАНКА. Она живёт в обычном,
 * не отложенном модуле: страж, который сам грузится по сети, оставлял бы
 * промежуток, когда решение о доступе ещё не принято.
 */
function UnlockedOnly() {
  const state = useOnboardingState()
  const session = useDirectorySession()

  if (session.isRestoring) {
    return <AppShell />
  }

  if (import.meta.env.MODE !== 'test' && session.user === null) {
    return <Navigate to={ROUTE.Welcome} replace />
  }

  if (state === ONBOARDING_STATE.Loading && session.user === null) {
    return <LoadingScreen />
  }

  if (state !== ONBOARDING_STATE.Unlocked && session.user === null) {
    return <Navigate to={ROUTE.Welcome} replace />
  }

  return <AppShell />
}

/** Заглушка на время чтения хранилища и загрузки чанка экрана. */
function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

/**
 * Заглушка внутри оболочки кошелька.
 *
 * Отличается от полноэкранной: шапка и панель навигации уже отрисованы
 * и остаются на месте. Подмена их полноэкранной заставкой при каждом
 * переходе читалась бы как перезагрузка приложения.
 */
function SectionFallback() {
  return (
    <div className="flex min-h-40 flex-col gap-3" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

/**
 * Маршрутизация приложения.
 *
 * ИСПОЛЬЗУЕТСЯ `BrowserRouter`. Страницы живут по обычным путям
 * (`/wallet`, `/admin`), а не в хэше. Неизвестный путь без `/v1`
 * отдаёт `index.html` — иначе обновление `/wallet/settings`
 * упиралось бы в 404.
 *
 * ЭКРАНЫ КОШЕЛЬКА ВЛОЖЕНЫ В ОБЩИЙ МАРШРУТ-ЛЕЙАУТ. Шапка и панель навигации
 * остаются смонтированными при переходах: пересоздание их на каждом экране
 * дало бы мерцание и потерю положения прокрутки.
 *
 * ЭКРАНЫ ЗАГРУЖАЮТСЯ ПО ТРЕБОВАНИЮ, кроме приветствия, разблокировки
 * и восстановления доступа — см. `lazy-pages.ts`.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Экраны входа делят живой фон через общий маршрут-лейаут:
            иначе он перезапускал бы анимацию при каждом переходе. */}
        <Route element={<AuthLayout />}>
          <Route path={ROUTE.Welcome} element={<StateGate />} />
          <Route
            path={ROUTE.Create}
            element={
              <Suspense fallback={<LoadingScreen />}>
                <CreateWalletPage />
              </Suspense>
            }
          />
          {/* ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ. Маршрут закрыт вместе с кнопкой:
              скрытая кнопка при открытом адресе означала бы, что путь
              всё ещё доступен любому, кто наберёт его руками. */}
          {TEST_MODE.hideSeedImport ? null : (
            <Route
              path={ROUTE.Import}
              element={
                <Suspense fallback={<LoadingScreen />}>
                  <ImportWalletPage />
                </Suspense>
              }
            />
          )}
          <Route path={ROUTE.Unlock} element={<UnlockWalletPage />} />
          <Route path={ROUTE.Trust} element={<TrustPage />} />
          <Route path={ROUTE.ForgotPassword} element={<ForgotPasswordPage />} />
        </Route>

        <Route path={ROUTE.Admin} element={<AdminPage />}>
          <Route
            element={
              <Suspense fallback={<SectionFallback />}>
                <Outlet />
              </Suspense>
            }
          >
            <Route index element={<AdminUsersPage />} />
            <Route path="sendings" element={<AdminSendingsPage />} />
            <Route path="users/:userId" element={<AdminUserPage />} />
          </Route>
        </Route>

        <Route path={ROUTE.EmailManager} element={<EmailManagerPage />}>
          <Route index element={<EmailConversationsPage />} />
          <Route path="new" element={<EmailNewConversationPage />} />
          <Route path=":conversationId" element={<EmailConversationPage />} />
        </Route>

        <Route path={ROUTE.Dashboard} element={<UnlockedOnly />}>
          {/* Одна граница ожидания на все разделы: она лежит внутри
              оболочки, поэтому шапка и навигация при переходе остаются
              на месте. */}
          <Route
            element={
              <Suspense fallback={<SectionFallback />}>
                <Outlet />
              </Suspense>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="send" element={<SendPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="nft" element={<NftPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="backup" element={<BackupPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to={ROUTE.Welcome} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
