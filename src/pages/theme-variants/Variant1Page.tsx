import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Clock3,
  Compass,
  Copy,
  Menu,
  Plus,
  ScanLine,
  Settings,
} from 'lucide-react'

import { AccountAvatar } from '@/features/wallet/ui/AccountAvatar'

import { InertButton, ThemeVariantStudio, TokenGlyph } from './ThemeVariantStudio'
import { VARIANT_ACCOUNT, VARIANT_BALANCE, VARIANT_TOKENS } from './mock-data'

/**
 * Study 1: MetaMask extension chrome.
 *
 * Dark column at popup width, ether first, orange accent.
 * The fox mark is an original geometric drawing, not a trademark.
 */
export function Variant1Page() {
  return (
    <ThemeVariantStudio theme="metamask">
      <div className="tv-frame">
        <header className="flex items-center gap-2 px-3 pt-3 pb-1">
          <InertButton className="rounded-lg p-2 text-muted-foreground" aria-label="Menu">
            <Menu className="size-5" />
          </InertButton>

          <InertButton className="mx-auto flex min-w-0 items-center gap-2 rounded-full bg-card px-2 py-1.5">
            <AccountAvatar address={VARIANT_ACCOUNT.address} className="size-7" />
            <span className="flex min-w-0 flex-col items-start">
              <span className="text-sm leading-none font-semibold">{VARIANT_ACCOUNT.name}</span>
              <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {VARIANT_ACCOUNT.shortAddress}
              </span>
            </span>
            <Copy className="size-3.5 text-muted-foreground" aria-hidden />
          </InertButton>

          <InertButton
            className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1.5 text-xs font-medium"
            aria-label={VARIANT_ACCOUNT.network}
          >
            <span className="size-2 rounded-full bg-[#8b99ff]" aria-hidden />
            {VARIANT_ACCOUNT.network}
          </InertButton>
        </header>

        <main className="flex flex-1 flex-col px-4 pt-6 pb-3">
          <p className="text-center text-xs text-muted-foreground">{VARIANT_ACCOUNT.network}</p>
          <h1 className="mt-1 text-center text-[2.5rem] leading-none font-semibold tracking-tight">
            {VARIANT_BALANCE.eth} ETH
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">{VARIANT_BALANCE.fiat}</p>

          <div className="mt-6 flex justify-center gap-3">
            <InertButton className="tv-mm-action">
              <span className="tv-mm-action-icon">
                <ArrowUpRight className="size-5" aria-hidden />
              </span>
              Send
            </InertButton>
            <InertButton className="tv-mm-action">
              <span className="tv-mm-action-icon">
                <ArrowDownLeft className="size-5" aria-hidden />
              </span>
              Receive
            </InertButton>
            <InertButton className="tv-mm-action">
              <span className="tv-mm-action-icon">
                <ArrowLeftRight className="size-5" aria-hidden />
              </span>
              Swap
            </InertButton>
            <InertButton className="tv-mm-action">
              <span className="tv-mm-action-icon">
                <Plus className="size-5" aria-hidden />
              </span>
              Buy
            </InertButton>
          </div>

          <div className="mt-6 flex items-center justify-between border-b border-border px-1 pb-2">
            <p className="text-sm font-semibold">Tokens</p>
            <InertButton className="rounded-md p-1 text-muted-foreground" aria-label="More tokens">
              <ScanLine className="size-4" />
            </InertButton>
          </div>

          <ul className="flex flex-col">
            {VARIANT_TOKENS.map((token) => (
              <li key={token.symbol}>
                <InertButton className="flex w-full items-center gap-3 py-3 text-left">
                  <TokenGlyph token={token} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{token.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {token.amount} {token.symbol}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium">{token.fiat}</span>
                    <span
                      className={
                        token.isUp ? 'block text-xs text-[#8ce99a]' : 'block text-xs text-[#ffa680]'
                      }
                    >
                      {token.change}
                    </span>
                  </span>
                </InertButton>
              </li>
            ))}
          </ul>

          <InertButton className="mt-1 w-full py-3 text-center text-sm font-semibold text-primary-emphasis">
            Import tokens
          </InertButton>
        </main>

        <nav
          aria-label="MetaMask sections"
          className="mt-auto flex border-t border-border px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          {(
            [
              { label: 'Home', icon: FoxMark, active: true },
              { label: 'Activity', icon: Clock3, active: false },
              { label: 'Explore', icon: Compass, active: false },
              { label: 'Settings', icon: Settings, active: false },
            ] as const
          ).map((item) => (
            <InertButton
              key={item.label}
              className={item.active ? 'tv-nav-item is-active flex-1' : 'tv-nav-item flex-1'}
            >
              <span
                className={
                  item.active
                    ? 'flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-foreground'
                    : 'flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground'
                }
              >
                <item.icon className={item.active ? 'size-5 text-primary' : 'size-5'} />
                {item.label}
              </span>
            </InertButton>
          ))}
        </nav>
      </div>
    </ThemeVariantStudio>
  )
}

function FoxMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#ff5c16"
        d="M4 7.2 8.2 4l3.8 3.1L15.8 4 20 7.2l-2.2 5.1.8 6.2-6.6 2.5-6.6-2.5.8-6.2Z"
      />
      <path fill="#ffd4c1" d="M9.1 13.4 12 16.2l2.9-2.8-1.1 4.6h-3.6Z" />
    </svg>
  )
}
