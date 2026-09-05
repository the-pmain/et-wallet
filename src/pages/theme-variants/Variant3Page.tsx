import { ChartPie, FileCode, History, LayoutGrid, Lock, Settings, Wallet } from 'lucide-react'

import { AccountAvatar } from '@/features/wallet/ui/AccountAvatar'
import { APP_CONFIG } from '@/shared/config'
import { BrandMark } from '@/shared/ui/brand-mark'

import { InertButton, ThemeVariantStudio, TokenGlyph } from './ThemeVariantStudio'
import { VARIANT_ACCOUNT, VARIANT_BALANCE, VARIANT_SENDINGS, VARIANT_TOKENS } from './mock-data'

const CABINET_NAV = [
  { label: 'Wallet', icon: Wallet, active: true },
  { label: 'Assets', icon: LayoutGrid, active: false },
  { label: 'Activity', icon: History, active: false },
  { label: 'Settings', icon: Settings, active: false },
] as const

/**
 * Study 3: ETWallet cabinet.
 *
 * Web width, fiat first, sendings instead of a DeFi feed. This is the
 * product's own language — not an extension and not a mobile hub.
 */
export function Variant3Page() {
  return (
    <ThemeVariantStudio theme="cabinet">
      <div className="tv-frame">
        <div className="flex min-h-[calc(100svh-var(--tv-studio-height))] flex-col lg:flex-row">
          <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-background/80 px-3 py-4 lg:flex">
            <div className="mb-4 flex items-center gap-2.5 px-2 py-1">
              <BrandMark alt="" className="size-10" />
              <span className="text-base font-semibold tracking-tight">
                {APP_CONFIG.brandLabel}
              </span>
            </div>

            <nav aria-label="Cabinet sections" className="flex flex-col gap-1">
              {CABINET_NAV.map((item) => (
                <InertButton
                  key={item.label}
                  className={
                    item.active
                      ? 'flex items-center gap-3 rounded-lg bg-primary/12 px-3 py-2.5 text-sm font-medium text-primary-emphasis'
                      : 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground'
                  }
                >
                  <item.icon className="size-4.5" />
                  {item.label}
                </InertButton>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
              <InertButton className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1.5">
                <AccountAvatar
                  address={VARIANT_ACCOUNT.email}
                  label={VARIANT_ACCOUNT.displayName}
                />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-semibold">
                    {VARIANT_ACCOUNT.displayName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {VARIANT_ACCOUNT.email}
                  </span>
                </span>
              </InertButton>

              <InertButton
                className="ml-auto rounded-lg p-2 text-muted-foreground"
                aria-label="Lock"
              >
                <Lock className="size-4" />
              </InertButton>
            </header>

            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 pb-24 lg:pb-8">
              <section
                className="rounded-xl border border-border/60 p-6 shadow-raised"
                style={{ background: 'var(--tv-hero)' }}
              >
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Balance
                </p>
                <h1 className="mt-3 text-4xl leading-none font-semibold tracking-tight sm:text-5xl">
                  {VARIANT_BALANCE.fiat}
                </h1>

                <div className="mt-6 flex flex-wrap gap-2">
                  <CabinetAction>Send</CabinetAction>
                  <CabinetAction>Receive</CabinetAction>
                  <CabinetAction icon={ChartPie}>Portfolio</CabinetAction>
                  <CabinetAction icon={FileCode}>Smart contract</CabinetAction>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-border/60 bg-card">
                  <h2 className="px-5 pt-5 text-base font-medium text-muted-foreground">Assets</h2>
                  <ul className="mt-1 pb-2">
                    {VARIANT_TOKENS.map((token) => (
                      <li key={token.symbol}>
                        <InertButton className="flex w-full items-center gap-3 px-5 py-3 text-left">
                          <TokenGlyph token={token} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{token.symbol}</span>
                            <span className="block text-xs text-muted-foreground">
                              {token.name}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block text-sm font-medium">{token.amount}</span>
                            <span className="block text-xs text-muted-foreground">
                              {token.fiat}
                            </span>
                          </span>
                        </InertButton>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-xl border border-border/60 bg-card">
                  <h2 className="px-5 pt-5 text-base font-medium text-muted-foreground">
                    Recent sendings
                  </h2>
                  <ul className="mt-1 pb-2">
                    {VARIANT_SENDINGS.map((sending) => (
                      <li key={sending.id} className="flex items-center gap-3 px-5 py-3">
                        <span
                          className={
                            sending.direction === 'in'
                              ? 'flex size-9 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary-emphasis'
                              : 'flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold'
                          }
                        >
                          {sending.direction === 'in' ? 'In' : 'Out'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{sending.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {sending.detail} · {sending.when}
                          </span>
                        </span>
                        <span className="text-sm font-medium">{sending.amount}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                This page is a web wallet. The code is downloaded each time it is opened. Compare
                the address character by character before sending.
              </p>
            </main>

            <nav
              aria-label="Cabinet sections"
              className="fixed inset-x-0 bottom-0 flex border-t border-border/60 bg-background/90 px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
            >
              {CABINET_NAV.map((item) => (
                <InertButton
                  key={item.label}
                  className={
                    item.active
                      ? 'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-primary-emphasis'
                      : 'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground'
                  }
                >
                  <item.icon className="size-4.5" />
                  {item.label}
                </InertButton>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </ThemeVariantStudio>
  )
}

function CabinetAction({
  children,
  icon: Icon,
}: {
  readonly children: string
  readonly icon?: typeof ChartPie
}) {
  return (
    <InertButton className="inline-flex items-center gap-2 rounded-full bg-primary/12 px-3.5 py-2 text-sm font-medium text-primary-emphasis">
      {Icon !== undefined ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </InertButton>
  )
}
