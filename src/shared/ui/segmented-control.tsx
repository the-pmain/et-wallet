import type { ComponentType } from 'react'

import { cn } from '@/shared/lib/utils'

export interface ISegmentedOption<TValue extends string | number> {
  readonly value: TValue
  readonly label: string

  /**
   * Icon next to the label.
   *
   * Optional: history filters have none, theme choice has one.
   * The icon supplements the label and does not replace it — a
   * set of icons alone forces guessing, and a wallet has nothing
   * to guess about.
   */
  readonly icon?: ComponentType<{ className?: string }> | undefined

  /**
   * Accessible name when the visible label is not enough to tell
   * options apart.
   *
   * Needed where a short label repeats in a neighboring set: two
   * buttons named “All” are indistinguishable to someone who hears
   * the page rather than looks at it.
   */
  readonly name?: string | undefined
}

export interface SegmentedControlProps<TValue extends string | number> {
  readonly options: readonly ISegmentedOption<TValue>[]
  readonly value: TValue
  readonly onChange: (value: TValue) => void

  /**
   * Visible name of the set.
   *
   * Required, not optional. A button set with no name forces
   * guessing what it controls, and guessing in a wallet ends in
   * the wrong speed or the wrong filter.
   */
  readonly legend: string

  readonly className?: string | undefined
}

/**
 * Choose one value from a set.
 *
 * A SHARED PRIMITIVE, NOT A COPY ON EACH SCREEN. This switch
 * appeared independently on history filters and on send speed,
 * and the sets were already drifting — different height, different
 * selected look. Controls that mean the same thing but look
 * different read as different in purpose.
 *
 * THE SELECTION IS MARKED THREE WAYS AT ONCE: color, elevation,
 * and `aria-pressed`. Color as the only cue is unavailable to
 * people with impaired color vision and is not read by assistive
 * technology.
 *
 * HEIGHT 44 PIXELS — the lower bound for a finger tap. Both
 * filters and send speed are pressed on a phone at least as often
 * as with a mouse.
 */
export function SegmentedControl<TValue extends string | number>({
  options,
  value,
  onChange,
  legend,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {legend}
      </legend>

      {/* Shared track under the whole set. Without it the buttons
          read as separate actions, not as choosing one value from
          a row. */}
      <div
        className="grid gap-1 rounded-xl bg-muted/60 p-1"
        style={{ gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const isSelected = option.value === value
          const Icon = option.icon

          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={isSelected}
              aria-label={option.name}
              onClick={() => {
                onChange(option.value)
              }}
              className={cn(
                /* No borders: inside the track they would draw a
                   second grid on top of the first. */
                'focus-ring flex min-h-11 cursor-pointer items-center justify-center gap-1.5 truncate rounded-lg px-2 text-xs font-medium transition-all',
                isSelected
                  ? 'bg-primary/15 text-primary-emphasis shadow-surface'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon === undefined ? null : <Icon className="size-4 shrink-0" />}
              <span className="truncate">{option.label}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
