import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Compass,
  Copy,
  Eye,
  Globe,
  History,
  QrCode,
  Settings,
  Wallet,
} from 'lucide-react'

import { InertButton, ThemeVariantStudio, TokenGlyph } from './ThemeVariantStudio'
import { VARIANT_ACCOUNT, VARIANT_BALANCE, VARIANT_TOKENS } from './mock-data'

/**
 * Study 2: Trust Wallet home screen.
 *
 * Mobile column, fiat first, colored action circles, blue-green accent.
 * The shield is an original drawing, not a trademark.
 */
export function Variant2Page() {
  return (
    <ThemeVariantStudio theme="trust">
      <div className="tv-frame">
        <header className="flex items-center gap-2 px-4 pt-4">
          <InertButton className="flex min-w-0 items-center gap-2">
            <ShieldMark className="size-8 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold">
                {VARIANT_ACCOUNT.walletName}
              </span>
              <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                {VARIANT_ACCOUNT.shortAddress}
                <Copy className="size-3" aria-hidden />
              </span>
            </span>
          </InertButton>

          <div className="ml-auto flex items-center gap-1">
            <InertButton className="rounded-full p-2 text-muted-foreground" aria-label="Scan">
              <QrCode className="size-5" />
            </InertButton>
            <InertButton
              className="rounded-full p-2 text-muted-foreground"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
            </InertButton>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-4 pt-7 pb-3">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">Total balance</p>
            <InertButton aria-label="Hide balance">
              <Eye className="size-4" />
            </InertButton>
          </div>

          <h1 className="mt-1 text-center text-[2.75rem] leading-none font-bold tracking-tight">
            {VARIANT_BALANCE.fiat}
          </h1>
          <p className="mt-2 text-center text-sm font-medium text-[color:var(--tv-green)]">
            {VARIANT_BALANCE.change}{' '}
            <span className="text-muted-foreground">{VARIANT_BALANCE.changeAmount}</span>
          </p>

          <div className="mt-7 flex justify-between gap-1">
            <InertButton className="tv-tw-action tv-tw-action--send">
              <span className="tv-tw-action-icon">
                <ArrowUpRight className="size-5" aria-hidden />
              </span>
              <span className="text-[11px] font-medium">Send</span>
            </InertButton>
            <InertButton className="tv-tw-action tv-tw-action--receive">
              <span className="tv-tw-action-icon">
                <ArrowDownLeft className="size-5" aria-hidden />
              </span>
              <span className="text-[11px] font-medium">Receive</span>
            </InertButton>
            <InertButton className="tv-tw-action tv-tw-action--buy">
              <span className="tv-tw-action-icon">
                <span className="text-lg leading-none font-semibold">+</span>
              </span>
              <span className="text-[11px] font-medium">Buy</span>
            </InertButton>
            <InertButton className="tv-tw-action tv-tw-action--swap">
              <span className="tv-tw-action-icon">
                <ArrowLeftRight className="size-5" aria-hidden />
              </span>
              <span className="text-[11px] font-medium">Swap</span>
            </InertButton>
            <InertButton className="tv-tw-action tv-tw-action--earn">
              <span className="tv-tw-action-icon">
                <span className="text-sm font-bold">%</span>
              </span>
              <span className="text-[11px] font-medium">Earn</span>
            </InertButton>
          </div>

          <div className="mt-7 flex rounded-full bg-muted p-1">
            <InertButton className="flex-1 rounded-full bg-card py-1.5 text-sm font-semibold">
              Crypto
            </InertButton>
            <InertButton className="flex-1 rounded-full py-1.5 text-sm text-muted-foreground">
              NFTs
            </InertButton>
          </div>

          <ul className="mt-2 flex flex-col">
            {VARIANT_TOKENS.map((token) => (
              <li key={token.symbol}>
                <InertButton className="flex w-full items-center gap-3 py-3.5 text-left">
                  <TokenGlyph token={token} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{token.symbol}</span>
                    <span className="block text-xs text-muted-foreground">{token.name}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold">{token.amount}</span>
                    <span className="block text-xs text-muted-foreground">{token.fiat}</span>
                  </span>
                  <span
                    className="w-14 text-right text-xs font-semibold"
                    style={{ color: token.isUp ? 'var(--tv-green)' : '#ff7a7a' }}
                  >
                    {token.change}
                  </span>
                </InertButton>
              </li>
            ))}
          </ul>
        </main>

        <nav
          aria-label="Trust Wallet sections"
          className="mt-auto flex border-t border-border px-1 pt-1 pb-[max(0.85rem,env(safe-area-inset-bottom))]"
        >
          {(
            [
              { label: 'Home', icon: Wallet, active: true },
              { label: 'Discover', icon: Compass, active: false },
              { label: 'Browser', icon: Globe, active: false },
              { label: 'History', icon: History, active: false },
              { label: 'Settings', icon: Settings, active: false },
            ] as const
          ).map((item) => (
            <InertButton
              key={item.label}
              className={item.active ? 'tv-nav-item is-active flex-1' : 'flex-1'}
            >
              <span
                className={
                  item.active
                    ? 'flex flex-col items-center gap-1 py-2 text-[10px] font-medium'
                    : 'flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-muted-foreground'
                }
              >
                <item.icon className="size-5" />
                {item.label}
              </span>
            </InertButton>
          ))}
        </nav>
      </div>
    </ThemeVariantStudio>
  )
}

function ShieldMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        fill="#2f6bff"
        d="M16 3.2 26 7.4v8.2c0 6.2-4.4 10.6-10 13.2-5.6-2.6-10-7-10-13.2V7.4Z"
      />
      <path fill="#ffffff" d="M14.2 19.6 10.6 16l1.5-1.5 2.1 2.1 5.3-5.4 1.5 1.5Z" />
    </svg>
  )
}
