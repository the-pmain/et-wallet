import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

/**
 * How many records before virtualization turns on.
 *
 * Below this the list is drawn in full, and that is a choice, not a
 * compromise: a full list has browser find, print, and mouse
 * selection, and the gain from virtualizing thirty rows is
 * unmeasurable. Virtualization belongs where an ordinary list starts
 * costing frames — and only there.
 */
const DEFAULT_THRESHOLD = 50

/**
 * How many rows are drawn outside the visible area.
 *
 * Without a buffer, fast scrolling shows emptiness: the browser
 * paints a frame before the scroll handler recomputes the window.
 */
const DEFAULT_OVERSCAN = 6

/**
 * Viewport height when it cannot be measured.
 *
 * That happens on the first paint before attach and in an environment
 * without layout. Zero here would mean an empty list instead of
 * content, so a deliberately large value is used: extra rows paint
 * and vanish after the first measure, and an empty screen the user
 * would notice.
 */
const FALLBACK_VIEWPORT_HEIGHT = 900

interface VirtualListProps<TItem> {
  readonly items: readonly TItem[]

  /**
   * Height of one row in pixels.
   *
   * MUST MATCH THE REAL HEIGHT. A mismatch does not lose data, but
   * it shifts the window: rows start to “slide” while scrolling.
   * So a row must have a fixed height, not one that depends on
   * content length.
   */
  readonly itemHeight: number

  readonly renderItem: (item: TItem, index: number) => ReactNode
  readonly getKey: (item: TItem, index: number) => string

  readonly threshold?: number
  readonly overscan?: number

  readonly className?: string
  readonly itemClassName?: string
}

/**
 * List that draws only the visible rows.
 *
 * WHY. Transfer history for an active address reaches hundreds of
 * records. Each row is nine DOM nodes, two icons, and amount
 * parsing; five hundred of those slow scroll on a weak device and
 * hold memory for nodes nobody sees.
 *
 * WHAT VIRTUALIZATION BREAKS, AND WHY THAT IS ACCEPTABLE HERE. Rows
 * do not exist in the document until they enter the viewport:
 * browser find (Ctrl+F) will miss them, print will output only the
 * visible ones. That is a real loss, and it is acceptable only
 * because the history screen has its own filters — direction, asset
 * kind, and counterparty. A list without its own search must not be
 * virtualized.
 *
 * THE SCREEN READER GETS THE FULL SIZE. `aria-setsize` and
 * `aria-posinset` report how many records there are and which one
 * is being read: without them the reader would announce “list of
 * twelve items” where there are five hundred.
 *
 * SCROLL IS WINDOW SCROLL, NOT AN INNER ONE. An inner scroll area
 * would give a second bar inside the first; at 360px that means the
 * user is scrolling the wrong thing.
 */
export function VirtualList<TItem>({
  items,
  itemHeight,
  renderItem,
  getKey,
  threshold = DEFAULT_THRESHOLD,
  overscan = DEFAULT_OVERSCAN,
  className,
  itemClassName,
}: VirtualListProps<TItem>) {
  const containerRef = useRef<HTMLUListElement>(null)
  const [range, setRange] = useState<IRange>({ start: 0, end: items.length })

  const isVirtual = items.length > threshold

  /**
   * Recomputes the visible window from the list's position in the
   * viewport.
   *
   * Uses `getBoundingClientRect`, not accumulated scroll: the list
   * sits under a header and warnings of variable height, and
   * subtracting those by hand would duplicate the layout in code.
   */
  const measure = useCallback(() => {
    const container = containerRef.current

    if (container === null) {
      return
    }

    const viewportHeight = globalThis.innerHeight || FALLBACK_VIEWPORT_HEIGHT
    const top = container.getBoundingClientRect().top

    const hidden = Math.max(0, Math.floor(-top / itemHeight))
    const visibleCount = Math.ceil(viewportHeight / itemHeight)

    const start = Math.max(0, hidden - overscan)
    const end = Math.min(items.length, hidden + visibleCount + overscan)

    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    )
  }, [itemHeight, items.length, overscan])

  useEffect(() => {
    if (!isVirtual) {
      return
    }

    measure()

    /* Listeners are passive: they cancel nothing, so the browser
       does not wait for them before scrolling. */
    const options: AddEventListenerOptions = { passive: true }

    globalThis.addEventListener('scroll', measure, options)
    globalThis.addEventListener('resize', measure, options)

    return () => {
      globalThis.removeEventListener('scroll', measure)
      globalThis.removeEventListener('resize', measure)
    }
  }, [isVirtual, measure])

  if (!isVirtual) {
    return (
      <ul ref={containerRef} className={className}>
        {items.map((item, index) => (
          <li key={getKey(item, index)} className={itemClassName}>
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    )
  }

  const visible = items.slice(range.start, range.end)
  const paddingTop = range.start * itemHeight
  const paddingBottom = Math.max(0, (items.length - range.end) * itemHeight)

  return (
    <ul
      ref={containerRef}
      className={className}
      /* Padding instead of spacer elements: an empty `li` would
         enter the screen reader's item count. */
      style={{ paddingTop, paddingBottom }}
    >
      {visible.map((item, offset) => {
        const index = range.start + offset

        return (
          <li
            key={getKey(item, index)}
            className={cn(itemClassName, 'box-border')}
            style={{ height: itemHeight }}
            aria-setsize={items.length}
            aria-posinset={index + 1}
          >
            {renderItem(item, index)}
          </li>
        )
      })}
    </ul>
  )
}

/** Visible-window bounds. The end is exclusive. */
interface IRange {
  readonly start: number
  readonly end: number
}
