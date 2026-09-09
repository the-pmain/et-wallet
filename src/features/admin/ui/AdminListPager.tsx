import { Button } from '@/shared/ui'

interface AdminListPagerProps {
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly onPageChange: (page: number) => void
}

/** Previous / next for a cabinet directory page. */
export function AdminListPager({ page, pageSize, total, onPageChange }: AdminListPagerProps) {
  if (total === 0) {
    return null
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 pt-1"
      aria-label="Pagination"
    >
      <p className="text-xs text-muted-foreground">
        Showing {String(start)}–{String(end)} of {String(total)}
      </p>
      <span className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            onPageChange(page - 1)
          }}
        >
          Previous
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          Page {String(page)} of {String(pageCount)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => {
            onPageChange(page + 1)
          }}
        >
          Next
        </Button>
      </span>
    </nav>
  )
}
