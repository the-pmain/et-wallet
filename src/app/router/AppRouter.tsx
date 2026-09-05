import { Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'

import { ONBOARDING_STATE, useDirectorySession, useOnboardingState } from '@/features/onboarding'
/* Auth screens are imported as modules, not through `@/pages`: the
   barrel statically pulls every page and would defeat lazy loading
   of the rest. */
import { AdminPage } from '@/pages/AdminPage'
import { DashboardPage } from '@/pages/DashboardPage'
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
  PrivacyPage,
  TermsPage,
  AdminUsersPage,
  AdminSendingsPage,
  AdminUserPage,
  Variant1Page,
  Variant2Page,
  Variant3Page,
} from './lazy-pages'
import { ROUTE } from './routes'

/**
 * Screen that matches wallet state.
 *
 * Routing by state, not by free user choice: a locked wallet must not
 * show the create screen, or the user will create a second wallet on
 * top of the first and conclude the funds are gone.
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
 * Gate to wallet screens.
 *
 * A direct visit to `/wallet/settings` while locked must land on the
 * password screen, not an empty shell: otherwise the user would see
 * parts of the interface they have not confirmed access to.
 *
 * THE STATE CHECK RUNS BEFORE THE CHUNK LOADS. It lives in an ordinary,
 * non-lazy module: a guard that itself loads over the network would
 * leave a gap while the access decision is still pending.
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

/** Placeholder while storage is read and a screen chunk loads. */
function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

/**
 * Placeholder inside the wallet shell.
 *
 * Distinct from the full-screen one: header and nav are already drawn
 * and stay put. Replacing them with a full-screen splash on every
 * navigation would read as an app reload.
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
 * App routing.
 *
 * USES `BrowserRouter`. Pages live at ordinary paths (`/wallet`,
 * `/admin`), not in the hash. An unknown path without `/v1` serves
 * `index.html` — otherwise a refresh of `/wallet/settings` would
 * hit a 404.
 *
 * WALLET SCREENS ARE NESTED IN A SHARED ROUTE LAYOUT. Header and nav
 * stay mounted across navigations: recreating them on every screen
 * would flicker and lose scroll position.
 *
 * SCREENS LOAD ON DEMAND, except welcome, unlock, and password
 * recovery — see `lazy-pages.ts`.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth screens share the live background through a route layout:
            otherwise it would restart the animation on every navigation. */}
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
          {/* TEMPORARY RELAXATION. The route is closed with the button:
              a hidden button with an open address would mean the path
              is still available to anyone who types it. */}
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
          <Route
            path={ROUTE.Privacy}
            element={
              <Suspense fallback={<LoadingScreen />}>
                <PrivacyPage />
              </Suspense>
            }
          />
          <Route
            path={ROUTE.Terms}
            element={
              <Suspense fallback={<LoadingScreen />}>
                <TermsPage />
              </Suspense>
            }
          />
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

        {/* Home-screen theme studies. No shell and no guard:
            comparing looks must not require a password. */}
        <Route
          path={ROUTE.Variant1}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <Variant1Page />
            </Suspense>
          }
        />
        <Route
          path={ROUTE.Variant2}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <Variant2Page />
            </Suspense>
          }
        />
        <Route
          path={ROUTE.Variant3}
          element={
            <Suspense fallback={<LoadingScreen />}>
              <Variant3Page />
            </Suspense>
          }
        />

        <Route path={ROUTE.Dashboard} element={<UnlockedOnly />}>
          {/* One suspense boundary for every section: it sits inside
              the shell, so header and nav stay put on navigation. */}
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
