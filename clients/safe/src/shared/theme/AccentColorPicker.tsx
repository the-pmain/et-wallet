import { Pipette } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/shared/lib/utils'

import { ACCENT_PRESETS, DEFAULT_ACCENT_HEX } from './accent'
import { parseHexColor } from './oklch'
import { useTheme } from './theme-context'

/**
 * Choose the wallet's main colour.
 *
 * Swatches first: a free picker without a short list forces guessing
 * which hues still read on both themes. Custom stays available for
 * a precise hex.
 */
export function AccentColorPicker() {
  const { accentHex, setAccentHex } = useTheme()
  const customId = useId()
  const selected = parseHexColor(accentHex) ?? DEFAULT_ACCENT_HEX
  const matchedPreset = ACCENT_PRESETS.find((preset) => preset.hex === selected)
  const isCustom = matchedPreset === undefined

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Main color
      </legend>

      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((preset) => {
          const isSelected = preset.hex === selected

          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => {
                setAccentHex(preset.hex)
              }}
              className={cn(
                'focus-ring size-9 shrink-0 cursor-pointer rounded-full border border-border/80 transition-transform',
                isSelected
                  ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                  : 'hover:scale-105',
              )}
              style={{ backgroundColor: preset.hex }}
            />
          )
        })}

        <label
          htmlFor={customId}
          className={cn(
            'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
            'relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border',
            isCustom && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
          style={isCustom ? { backgroundColor: selected } : undefined}
          title="Custom color"
        >
          <Pipette
            className={cn(
              'size-3.5',
              isCustom ? 'text-primary-foreground' : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <input
            id={customId}
            type="color"
            value={selected}
            aria-label="Custom color"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => {
              setAccentHex(event.target.value)
            }}
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {matchedPreset?.label ?? 'Custom'} — buttons, navigation, and backgrounds follow this
        colour. Light and Dark above stay as you set them.
      </p>
    </fieldset>
  )
}
