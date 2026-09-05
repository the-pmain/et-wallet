import { ChevronDown, Lock } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { ROUTE } from '@/app/router/routes'
import {
  ONBOARDING_STATE,
  readLoginCredentials,
  useDirectorySession,
  useOnboarding,
  useOnboardingState,
} from '@/features/onboarding'
import { AutoLockWarning, useSecurity } from '@/features/security'
import { AccountAvatar, SESSION_STATE, addressLabel, useWalletSnapshot } from '@/features/wallet'
import { APP_CONFIG } from '@/shared/config'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { BrandMark, Button, PAGE_COLUMN, Skeleton, Toaster } from '@/shared/ui'

import { AmbientBackground } from './AmbientBackground'
import { NAVIGATION } from './navigation'

/** Cabinet layout at `lg`. Matches the `@media (min-width: 1024px)` behind `lg:`. */
const CABINET_QUERY = '(min-width: 1024px)'

function subscribeCabinetLayout(onChange: () => void): () => void {
  const media = window.matchMedia(CABINET_QUERY)
  media.addEventListener('change', onChange)
  return () => {
    media.removeEventListener('change', onChange)
  }
}

/**
 * Wide cabinet or phone column.
 *
 * Both navs stay in the markup and cannot be hidden with `hidden` alone:
 * tests run with `css: false`, so both "Wallet sections" landmarks remain
 * in the accessibility tree. `matchMedia` is already stubbed in setup and
 * the query does not match, so tests see the same bottom bar as a phone.
 */
function useCabinetLayout(): boolean {
  return useSyncExternalStore(
    subscribeCabinetLayout,
    () => window.matchMedia(CABINET_QUERY).matches,
    () => false,
  )
}

/**
 * Shell for the unlocked wallet.
 *
 * WHY A ROUTE LAYOUT INSTEAD OF A WRAPPER ON EACH PAGE.
 * Five screens share the header and navigation; copying them into every
 * page would mean five places the bar can drift, and a header remount
 * on every navigation. A nested route with `Outlet` keeps the shared
 * parts mounted.
 *
 * Onboarding screens have no shell on purpose: there is nowhere to go
 * before unlock, and a nav bar on the password screen would imply that
 * part of the wallet is already available.
 */
export function AppShell() {
  const snapshot = useWalletSnapshot()
  const onboarding = useOnboarding()
  const onboardingState = useOnboardingState()
  const directory = useDirectorySession()
  const location = useLocation()
  const { autoLock } = useSecurity()
  const isCabinet = useCabinetLayout()
  const directoryUser = directory.user
  const showShellContent =
    snapshot.state === SESSION_STATE.Open || directoryUser !== null || directory.isRestoring

  /*
    Email sign-in opens the cabinet without unlocking on-device storage:
    the saved session skips the password screen. Without this step, send
    has no account and the buttons do nothing. The password is already
    in the same credentials that opened the cabinet.
  */
  useEffect(() => {
    if (directoryUser === null || onboardingState !== ONBOARDING_STATE.Locked) {
      return
    }

    const stored = readLoginCredentials()

    if (stored === null) {
      return
    }

    void onboarding.unlock(stored.theP).catch(() => {
      /* No local store, or the password for it is different. */
    })
  }, [directoryUser, onboarding, onboardingState])

  /*
    NAVIGATION MOVES FOCUS INTO THE CONTENT.

    Without this, a screen change was invisible to anyone listening to
    the page: tapping a nav item swapped the content, focus stayed on
    the link, and nothing was announced. The person never learned they
    had moved — the transition existed only for sighted users.

    Focus goes to the content region, not a heading: not every screen
    has a heading, the region always exists, and the screen reader
    starts at the top of it — which is the screen title when there is one.

    THE FIRST PAINT IS SKIPPED. Stealing focus on app open is pointless:
    the person has not navigated yet, and captured focus would interrupt
    anyone already tabbing through.

    COMPARE THE PREVIOUS PATH; DO NOT COUNT PAINTS. The first version
    kept a "this is the first paint" flag and cleared it in the effect.
    In `StrictMode` React runs the effect twice: the first run cleared
    the flag, the second stole focus — exactly where it must not.
    Measured live. Path comparison does not depend on how many times
    the effect runs: while the path is unchanged, focus is left alone.
  */
  const contentRef = useRef<HTMLElement>(null)
  const previousPath = useRef<string | null>(null)

  useEffect(() => {
    const previous = previousPath.current
    previousPath.current = location.pathname

    if (previous === null || previous === location.pathname) {
      return
    }

    /* Do not scroll: the screen is already at the top, and the browser
       would otherwise jump to the region that just rendered. */
    contentRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  return (
    <div className="relative flex min-h-svh min-w-0 justify-center overflow-x-clip bg-background">
      {/* Background is fixed to the viewport and sits under everything:
          header and nav blur it with their own filter, and cards are
          opaque — text is read on them, not on the background. */}
      <AmbientBackground />

      {/* Toaster is mounted once for the whole shell. */}
      <Toaster />

      {/*
        TWO MODES, ONE SHELL.

        At `lg` — cabinet: `PAGE_COLUMN`, tabs in the header, like an
        admin console. Below `lg` the reference is the variant-1 study:
        26.25rem column, account pill centered, tabs inside the column
        rather than across the full tablet width. A bottom bar with
        `inset-x-0` on iPad stretched four items across 768px and
        broke that reference.
      */}
      <div className="wallet-phone-column relative z-10 min-w-0 lg:max-w-none">
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div
            className={cn(
              PAGE_COLUMN,
              'flex h-14 min-w-0 items-center gap-2 max-lg:px-3 lg:gap-3',
            )}
          >
            <BrandLockup className="shrink-0" />

            {isCabinet ? (
              <nav
                aria-label="Wallet sections"
                className="flex min-w-0 flex-1 items-center gap-1"
              >
                <WalletSectionLinks layout="tabs" />
              </nav>
            ) : null}

            <div className="flex h-11 min-w-0 flex-1 items-center justify-center lg:w-[14.5rem] lg:flex-none lg:justify-end">
              <WalletIdentity
                account={snapshot.activeAccount}
                ensNames={snapshot.ensNames}
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Lock the wallet"
              className="max-lg:rounded-full max-lg:bg-card"
              onClick={() => {
                directory.signOut()
                onboarding.lock()
              }}
            >
              <Lock className="size-4" aria-hidden />
            </Button>
          </div>
        </header>

        {/*
          A key on the path restarts the enter animation on each navigation.
          Without it React reuses the node and the transition looks like a jump.
        */}
        {/* Warning sits above the content and outside the route key:
            navigating must not reset it — time until lock is unchanged. */}
        <div className={cn(PAGE_COLUMN, 'relative z-10 w-full min-w-0 pt-2')}>
          <AutoLockWarning
            isVisible={autoLock.isWarning}
            remainingMs={autoLock.remainingMs}
            onExtend={autoLock.extend}
          />
        </div>

        {/* `relative z-10` is required: the background is positioned, and
            without an explicit layer unpositioned content would sink under it.

            The phone column needs no bottom padding: the bar is in flow,
            not fixed over the content. */}
        <main
          key={location.pathname}
          ref={contentRef}
          /* The region is focused only from script, on navigation:
             it is not in the tab order, and a focus ring here would be
             noise across the whole screen. */
          tabIndex={-1}
          className={cn(
            PAGE_COLUMN,
            'relative z-10 min-w-0 flex-1 animate-in pt-6 pb-3 duration-300 fade-in slide-in-from-bottom-2 focus:outline-none lg:py-6',
          )}
        >
          {showShellContent ? <Outlet /> : <ShellPlaceholder />}
        </main>

        {isCabinet ? null : (
          <nav
            aria-label="Wallet sections"
            className="mt-auto border-t border-border/60 bg-background/90 backdrop-blur-md"
          >
            <div className="flex items-stretch justify-around px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <WalletSectionLinks layout="bar" />
            </div>
          </nav>
        )}
      </div>
    </div>
  )
}

/**
 * Section links. Both bars call one function so the lists cannot drift.
 */
function WalletSectionLinks({ layout }: { readonly layout: 'bar' | 'tabs' }) {
  const { t } = useTranslation()

  return (
    <>
      {NAVIGATION.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === NAVIGATION[0]?.to}
          className={({ isActive }) =>
            layout === 'bar'
              ? cn(
                  'focus-ring flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'text-primary-emphasis'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:text-foreground',
                )
              : cn(
                  'focus-ring flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/12 text-primary-emphasis'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:text-foreground',
                )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  layout === 'bar' &&
                    'flex size-8 items-center justify-center rounded-lg transition-colors',
                  layout === 'bar' && isActive && 'bg-primary/12',
                )}
              >
                <item.icon className={layout === 'bar' ? 'size-4.5' : 'size-4'} />
              </span>
              {t(item.labelKey)}
            </>
          )}
        </NavLink>
      ))}
    </>
  )
}

/**
 * Product mark and name. One block: the mark has no caption, the name
 * is read on its own.
 */
function BrandLockup({ className }: { readonly className?: string }) {
  return (
    <Link
      to={ROUTE.Dashboard}
      className={cn('focus-ring flex items-center gap-2.5 rounded-lg', className)}
    >
      <BrandMark alt="" className="size-8 lg:size-9" />
      {/* On the phone column only the mark stays: the account pill is
          centered, and the full word on the left would push it aside.
          The product name remains in the link for the screen reader. */}
      <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap text-foreground max-lg:sr-only lg:text-base">
        {APP_CONFIG.brandLabel}
      </span>
    </Link>
  )
}

/**
 * THE PILL HUGS ITS CONTENT. Stretching it across the slot leaves a
 * hole between the avatar and the text. The slot outside holds the
 * header width; the pill does not.
 *
 * INSIDE — EVEN STEPS. `pl-1.5` seats the avatar in the rounding,
 * `gap-2` matches that inset, `pr-2.5` is slightly wider on the right:
 * how an avatar chip is built. The skeleton copies the same insets,
 * the same `size-7`, the same two lines — otherwise swapping in the
 * account would shift the header.
 */
const IDENTITY_CHIP =
  'flex h-11 w-max max-w-full min-w-0 items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-2.5'

function WalletIdentity({
  account,
  ensNames,
}: {
  readonly account: ReturnType<typeof useWalletSnapshot>['activeAccount']
  readonly ensNames: ReturnType<typeof useWalletSnapshot>['ensNames']
}) {
  if (account === null) {
    return (
      <div className={IDENTITY_CHIP} aria-hidden aria-busy>
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-col items-start">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="mt-0.5 h-2.5 w-20" />
        </div>
      </div>
    )
  }

  /* THE SWITCH LOOKS PRESSABLE. This used to be an arrow icon and
     plain text with no background and no hover: the arrow promised
     a picker the look did not confirm. The link goes to settings,
     where accounts are actually switched. */
  return (
    <Link
      to="/wallet/settings"
      className={cn(IDENTITY_CHIP, 'focus-ring transition-colors hover:bg-accent')}
    >
      <AccountAvatar address={account.address} className="size-7 shrink-0" />

      <div className="flex min-w-0 flex-col items-start">
        <span className="flex max-w-full items-center gap-1 text-sm leading-none font-semibold">
          <span className="truncate">{account.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        {/* ENS name instead of the address when verification confirmed it.
            Monospace is dropped: it exists for character-by-character
            comparison of an address, and a name is compared as a whole. */}
        <span
          className={cn(
            'mt-0.5 max-w-full truncate text-[11px] leading-none text-muted-foreground',
            !ensNames.has(account.address.toLowerCase()) && 'font-mono',
          )}
        >
          {addressLabel(account.address, ensNames)}
        </span>
      </div>
    </Link>
  )
}

/**
 * Placeholder while the session opens.
 *
 * Shown inside the shell, not instead of it: navigation and header
 * vanishing for a second on every entry read as a crash.
 */
function ShellPlaceholder() {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy>
      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-raised">
        <Skeleton className="mb-6 h-4 w-24" />
        <Skeleton className="h-10 w-52 sm:h-12" />
        <Skeleton className="mt-4 h-10 w-full" />
      </div>
      <div className="rounded-xl border border-border/60 bg-card">
        <div className="p-6 pb-3">
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-6 py-3.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
