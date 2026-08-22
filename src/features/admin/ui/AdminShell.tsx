import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui'

interface AdminShellProps {
  readonly children: ReactNode
  readonly onLock: () => void
}

const TABS = [
  {
    to: '/admin',
    label: 'Users',
    isActive: (pathname: string) => pathname === '/admin' || pathname.startsWith('/admin/users'),
  },
  {
    to: '/admin/sendings',
    label: 'Sendings',
    isActive: (pathname: string) => pathname === '/admin/sendings',
  },
] as const

/**
 * Оболочка кабинета: шапка и вкладки остаются при переходе к профилю.
 */
export function AdminShell({ children, onLock }: AdminShellProps) {
  const location = useLocation()

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-4">
            <p className="text-sm font-semibold tracking-tight">Admin</p>
            <nav aria-label="Admin sections" className="flex items-center gap-1">
              {TABS.map((tab) => {
                const active = tab.isActive(location.pathname)

                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/12 text-primary-emphasis'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onLock}>
            <Lock />
            Lock
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
