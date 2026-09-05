import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { cn } from '@/shared/lib/utils'

export interface ISelectOption<TValue extends string = string> {
  readonly value: TValue
  readonly label: string
}

export interface SelectProps<TValue extends string = string> {
  readonly id: string
  readonly value: TValue
  readonly options: readonly ISelectOption<TValue>[]
  readonly onChange: (value: TValue) => void
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly className?: string

  /**
   * Dangerous field — refuse a transfer. Same color as the other
   * destructive controls, not a separate palette.
   */
  readonly tone?: 'default' | 'danger' | 'success'

  /**
   * Where the list opens. Fields at the bottom of a dialog open
   * upward: otherwise the dialog `overflow` clips the list.
   */
  readonly menuPlacement?: 'bottom' | 'top'
}

/**
 * Choose one value from a list.
 *
 * NOT A NATIVE `<select>`. The system menu is drawn by the OS: in a
 * dark cabinet it pops up as a light rectangle and breaks the field
 * row. This component matches the app button and card.
 *
 * THE LIST STAYS IN THE SAME TREE, NOT A PORTAL. A modal `<dialog>`
 * lives in the browser top layer; a portal into `document.body`
 * would sit under the backdrop and would not be clickable.
 */
export function Select<TValue extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select',
  className,
  tone = 'default',
  menuPlacement = 'bottom',
}: SelectProps<TValue>) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null
  const [highlighted, setHighlighted] = useState(() => Math.max(selectedIndex, 0))

  useEffect(() => {
    if (!open) {
      return
    }

    setHighlighted(Math.max(selectedIndex, 0))

    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) {
        return
      }

      setOpen(false)
    }

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) {
      return
    }

    const option = rootRef.current?.querySelector(`[data-select-index="${String(highlighted)}"]`)

    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted, open])

  function choose(next: TValue): void {
    onChange(next)
    setOpen(false)
  }

  function handleTriggerKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()

      if (!open) {
        setOpen(true)
        return
      }

      const delta = event.key === 'ArrowDown' ? 1 : -1
      const count = options.length

      if (count === 0) {
        return
      }

      setHighlighted((current) => (current + delta + count) % count)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      const option = options[highlighted]

      if (option !== undefined) {
        choose(option.value)
      }
    }

    if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlighted(0)
    }

    if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlighted(Math.max(options.length - 1, 0))
    }
  }

  const toneClassName =
    tone === 'danger'
      ? 'border-destructive/50 bg-destructive/10 text-destructive'
      : tone === 'success'
        ? 'border-risk-low/50 bg-risk-low/10 text-risk-low'
        : 'bg-transparent'

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        {...(open ? { 'aria-activedescendant': optionDomId(listboxId, highlighted) } : {})}
        disabled={disabled}
        className={cn(
          'focus-ring flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border px-3 text-left text-sm shadow-xs',
          'disabled:cursor-not-allowed disabled:opacity-50',
          toneClassName,
        )}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current)
          }
        }}
        onKeyDown={handleTriggerKey}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected === null && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            'absolute right-0 left-0 z-30 max-h-60 overflow-y-auto rounded-xl border border-border/70 bg-card py-1 shadow-surface',
            menuPlacement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlighted

            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  id={optionDomId(listboxId, index)}
                  role="option"
                  aria-selected={isSelected}
                  data-select-index={index}
                  className={cn(
                    'focus-ring flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm',
                    isHighlighted ? 'bg-accent' : 'hover:bg-accent',
                  )}
                  onMouseEnter={() => {
                    setHighlighted(index)
                  }}
                  onClick={() => {
                    choose(option.value)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? (
                    <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function optionDomId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${String(index)}`
}
