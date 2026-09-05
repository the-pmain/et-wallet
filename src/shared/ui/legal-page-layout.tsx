import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { ROUTE } from '@/app/router/routes'
import { Button } from './button'

interface LegalPageLayoutProps {
  readonly title: string
  readonly children: ReactNode
}

/**
 * Shared shell for legal and information pages.
 *
 * Same back header and text width: without it each page would drift
 * in padding and heading size.
 */
export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  const location = useLocation()
  const backTo =
    location.state !== null &&
    typeof location.state === 'object' &&
    'from' in location.state &&
    location.state.from === 'wallet'
      ? ROUTE.Dashboard
      : ROUTE.Welcome

  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col gap-4 p-5 lg:min-h-0 lg:p-0">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to={backTo}>
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>

      <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

interface LegalSectionProps {
  readonly title: string
  readonly children: ReactNode
}

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}
