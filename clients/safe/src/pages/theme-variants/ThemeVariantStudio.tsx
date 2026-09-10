import { NavLink } from 'react-router'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

import type { IVariantToken } from './mock-data'
import './theme-variants.css'

export type ThemeVariantId = 'metamask' | 'trust' | 'cabinet'

const VARIANT_LINKS = [
  { to: '/variant-1', label: 'MetaMask' },
  { to: '/variant-2', label: 'Trust Wallet' },
  { to: '/variant-3', label: 'ELM cabinet' },
] as const

interface ThemeVariantStudioProps {
  readonly theme: ThemeVariantId
  readonly children: ReactNode
}

/**
 * Study shell: theme switcher and CSS-variable isolation.
 *
 * THE SWITCHER IS NOT PART OF THE WALLET. It sits above the mock so
 * comparison does not require remembering URLs. Buttons inside the
 * mock are deliberately inert.
 */
export function ThemeVariantStudio({ theme, children }: ThemeVariantStudioProps) {
  return (
    <div data-wallet-theme={theme} className="tv-root">
      <nav className="tv-studio" aria-label="Theme variants">
        <p className="tv-studio-note">Theme studies · buttons do nothing</p>
        <div className="tv-studio-links">
          {VARIANT_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('tv-studio-link', isActive && 'is-active')}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="tv-stage">{children}</div>
    </div>
  )
}

export function InertButton({
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cn('tv-inert', className)} {...props}>
      {children}
    </button>
  )
}

export function TokenGlyph({ token }: { readonly token: IVariantToken }) {
  return (
    <span className="tv-token-glyph" data-tone={token.tone} aria-hidden>
      {token.symbol}
    </span>
  )
}
