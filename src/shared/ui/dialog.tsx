import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

import { Button } from './button'

interface DialogProps {
  readonly isOpen: boolean
  readonly onClose: () => void

  /** Title. Also linked to the dialog for screen readers. */
  readonly title: string

  readonly description?: string

  readonly children?: ReactNode

  /** Action row. Without it the dialog closes only via the X and Escape. */
  readonly footer?: ReactNode

  readonly className?: string
}

/**
 * Modal dialog.
 *
 * BUILT ON NATIVE `<dialog>`, NOT A CUSTOM LAYER. The element gives
 * for free what is written by hand in dozens of lines and constantly
 * written wrong: focus trapped inside the dialog, Escape to close,
 * the rest of the document inert for screen readers, and the browser
 * top layer that needs no `z-index` and is not clipped by any
 * ancestor `overflow: hidden`.
 *
 * A homemade focus trap is a classic accessibility hole: it catches
 * Tab but not heading navigation, the virtual cursor, or screen-reader
 * gestures. `showModal` closes all those paths at once because it
 * does so at the browser level.
 *
 * BACKDROP CLOSE USES POINTER POSITION, NOT THE EVENT TARGET.
 * Checking `event.target === dialog` looks like it works, but breaks
 * on a press that starts inside the dialog and is released on the
 * backdrop: selecting text with the mouse would accidentally close
 * the dialog.
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog === null) {
      return
    }

    if (isOpen && !dialog.open) {
      /* `showModal` is missing in jsdom and is stubbed in test setup.
         The check here covers another environment without it: the
         dialog must still open non-modally rather than crash the
         screen. */
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }
    }

    if (!isOpen && dialog.open) {
      dialog.close()
    }
  }, [isOpen])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      /* `close` fires from Escape and from `dialog.close()`.
         Outer state must hear it: otherwise a dialog closed by
         the key would stay “open” in state, and pressing the
         button again would open nothing. */
      onClose={onClose}
      onClick={(event) => {
        const dialog = dialogRef.current

        if (dialog === null) {
          return
        }

        const box = dialog.getBoundingClientRect()
        const isInside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom

        /* A keyboard activation (Enter on a button) arrives with
           zero coordinates and would count as “outside”. */
        const isPointer = event.clientX !== 0 || event.clientY !== 0

        if (isPointer && !isInside) {
          dialog.close()
        }
      }}
      className={cn(
        /* `m-auto` IS REQUIRED, NOT DECORATION. The browser centers
           a modal itself, but it does so via `margin: auto` with
           `inset: 0`. Tailwind's reset zeros margins on every
           element, including that rule: the dialog stuck to the
           top-left corner. Measured; not checked by eye in this
           environment. */
        'm-auto w-[calc(100vw-2rem)] max-w-md',

        /* Tall content scrolls inside the dialog instead of leaving
           the screen: a top-layer element is not clipped by an
           ancestor, and without a limit the bottom of the dialog
           would be unreachable. */
        'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',

        'rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-raised',
        'backdrop:bg-background/70 backdrop:backdrop-blur-sm',
        'open:animate-in open:duration-200 open:zoom-in-95 open:fade-in',
        className,
      )}
    >
      {/* Inner wrapper is required: padding on `<dialog>` itself
          would join its rectangle, and a click on the padding
          would count as a click on the backdrop. */}
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-base leading-tight font-semibold text-balance">
              {title}
            </h2>

            {description === undefined ? null : (
              <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 shrink-0"
            aria-label="Close"
            onClick={() => {
              dialogRef.current?.close()
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {children}

        {footer === undefined ? null : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </div>
    </dialog>
  )
}
