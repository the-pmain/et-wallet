import { Button } from '@/shared/ui'

interface MailboxPagerProps {
  readonly page: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly busy: boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
}

/** Previous / Next for the Cloudflare mailbox endpoint. */
export function MailboxPager({
  page,
  hasPrevious,
  hasNext,
  busy,
  onPrevious,
  onNext,
}: MailboxPagerProps) {
  return (
    <nav aria-label="Mailbox pages" className="flex items-center justify-between gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={!hasPrevious || busy}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <p className="text-sm text-muted-foreground">Page {String(page)}</p>
      <Button type="button" variant="outline" disabled={!hasNext || busy} onClick={onNext}>
        Next
      </Button>
    </nav>
  )
}
