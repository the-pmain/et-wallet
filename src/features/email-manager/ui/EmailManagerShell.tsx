import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/shared/ui'

interface EmailManagerShellProps {
  readonly children: ReactNode
  readonly onLock: () => void
}

/**
 * Оболочка менеджера писем: шапка остаётся, пока открыта форма.
 */
export function EmailManagerShell({ children, onLock }: EmailManagerShellProps) {
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <p className="text-sm font-semibold tracking-tight">Email manager</p>
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
