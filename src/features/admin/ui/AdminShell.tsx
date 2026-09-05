import { Lock, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { cn } from '@/shared/lib/utils'
import { Button, PAGE_COLUMN } from '@/shared/ui'

import { ADMIN_ROLE, type AdminRole } from '../model/admin-role'
import { AdminSendingsLiveProvider } from '../model/admin-sendings-live'
import { AdminPendingSendingToasts } from './AdminPendingSendingToasts'

interface AdminShellProps {
  readonly children: ReactNode
  readonly role: AdminRole
  readonly pin: string
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

/** Cabinet shell: header and tabs stay when opening a profile. */
export function AdminShell({ children, role, pin, onLock }: AdminShellProps) {
  const location = useLocation()
  const isSuper = role === ADMIN_ROLE.Super
  const tabs = isSuper ? TABS : TABS.filter((tab) => tab.label === 'Users')

  const frame = (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className={cn(PAGE_COLUMN, 'flex h-14 items-center justify-between gap-4')}>
          <div className="flex min-w-0 items-center gap-4">
            <p
              className={cn(
                'flex items-center gap-1.5 text-sm font-semibold tracking-tight',
                isSuper &&
                  'text-amber-300 [text-shadow:0_0_10px_rgba(251,191,36,1),0_0_28px_rgba(245,158,11,0.9),0_0_56px_rgba(234,179,8,0.65),0_0_88px_rgba(202,138,4,0.45)]',
              )}
            >
              <User
                aria-hidden
                className={cn(
                  'size-4',
                  isSuper &&
                    '[filter:drop-shadow(0_0_8px_rgba(251,191,36,1))_drop-shadow(0_0_22px_rgba(245,158,11,0.9))_drop-shadow(0_0_44px_rgba(234,179,8,0.65))]',
                )}
              />
              {isSuper ? 'Super Admin' : 'Admin'}
            </p>
            <nav aria-label="Admin sections" className="flex items-center gap-1">
              {tabs.map((tab) => {
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
      <main className={cn(PAGE_COLUMN, 'py-6')}>{children}</main>
      {isSuper ? <AdminPendingSendingToasts /> : null}
    </div>
  )

  if (!isSuper) {
    return frame
  }

  return <AdminSendingsLiveProvider pin={pin}>{frame}</AdminSendingsLiveProvider>
}
