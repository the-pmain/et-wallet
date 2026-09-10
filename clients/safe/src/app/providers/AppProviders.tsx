import { useState, type ReactNode } from 'react'

import { OnboardingProvider, DirectorySessionProvider } from '@/features/onboarding'
import { WalletProvider } from '@/features/wallet'

import { createAppServices, type IAppServices } from '../composition/createAppServices'
import { AppErrorBoundary } from './AppErrorBoundary'
import { DappProvider } from './DappProvider'
import { DisplayCurrencyProvider } from '@/features/wallet/model/display-currency-context'
import { I18nProvider } from './I18nProvider'
import { MarketDataBootstrap } from './MarketDataBootstrap'
import { SecurityProvider } from './SecurityProvider'
import { ThemeProvider } from './ThemeProvider'

interface AppProvidersProps {
  children: ReactNode

  /** Ready-made service set. Used by tests to swap storage. */
  services?: IAppServices
}

/**
 * Single assembly point for every app provider.
 *
 * Why a separate component instead of nested providers in main.tsx:
 * provider order is architecture (the router must see lock state, lock
 * state must see storage, and so on). Keeping that order in one place
 * is cheaper than hunting it in the entry point, and it lets tests
 * reuse the whole provider tree.
 *
 * `OnboardingProvider` sits inside `ThemeProvider`: look does not
 * depend on wallet state, and the loading screen must render in the
 * right theme before storage is read.
 *
 * `WalletProvider` sits inside `OnboardingProvider`: the wallet
 * session opens and closes with lock state, so it must see it.
 *
 * SERVICES ARE CREATED IN A `useState` INITIALIZER, NOT IN THE
 * COMPONENT BODY. Calling on every render would create a new store
 * and lose the wallet on the first redraw.
 */
export function AppProviders({ children, services }: AppProvidersProps) {
  const [created] = useState(() => services ?? createAppServices())
  const value = services ?? created

  return (
    /* FAILURE CATCH IS THE OUTERMOST LAYER. An error in any provider
       or screen would unmount the whole tree, and the owner of funds
       would see a white screen — indistinguishable from money gone.
       Theme and locale stay inside: the failure screen must still
       render even if they broke. */
    <AppErrorBoundary>
      <ThemeProvider>
        {/* Locale wraps wallet state and sits inside theme: the loading
          screen already needs a language, and it does not depend on
          whether the wallet is open. */}
        <I18nProvider>
          <MarketDataBootstrap>
            <DisplayCurrencyProvider>
              <DirectorySessionProvider>
                <OnboardingProvider service={value.onboarding} broadcast={value.broadcast}>
                {/* Security sits inside onboarding and wraps the wallet
                session: auto-lock watches lock state, and its firing
                must close the session. */}
                <SecurityProvider
                  clock={value.clock}
                  settingsRepository={value.securitySettings}
                  storage={value.storage}
                >
                  <WalletProvider session={value.session}>
                    {/* Connections sit inside the wallet session: a
                    dapp request runs with its keys and on its network. */}
                    <DappProvider service={value.dappSessions}>{children}</DappProvider>
                  </WalletProvider>
                </SecurityProvider>
              </OnboardingProvider>
              </DirectorySessionProvider>
            </DisplayCurrencyProvider>
          </MarketDataBootstrap>
        </I18nProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  )
}
