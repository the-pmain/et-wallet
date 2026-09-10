import { cva } from 'class-variance-authority'

/**
 * Button appearance variants.
 *
 * Extracted from the component on purpose: React Fast Refresh works
 * correctly only when a module exports components alone. A component
 * next to a plain function in the same file breaks hot reload and
 * forces a full page reload on edits.
 *
 * Difference from stock shadcn/ui: the `destructive` variant has a
 * stronger focus ring. Confirming irreversible actions — sending
 * funds, deleting an account — must look different from ordinary
 * actions, including during keyboard navigation.
 */
export const buttonVariants = cva(
  /* `cursor-pointer` is set explicitly: Tailwind resets a button
     cursor to the arrow, and the control stops looking clickable.

     `active:scale` is press feedback. An instant state change with
     no feedback reads as “it did not press”, and the user presses
     again; in a wallet a second press on Send is expensive. Motion
     is removed under `prefers-reduced-motion`. */
  "tap-target focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/40',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary-emphasis underline-offset-4 hover:underline',
      },
      /*
        SIZES ARE RAISED, AND THE TAP TARGET IS BROUGHT TO 44 PIXELS.

        Live measurement found thirty buttons below that floor: stock
        shadcn gives 32px for `sm`, 36 for default, and 40 for large.
        They pass the WCAG minimum (24×24), but 44 is the size at
        which hitting with a finger stops being a lottery, and the
        wallet is opened from a phone.

        Raised moderately, four pixels each: taking the visible size
        to 44 would turn settings into a stack of slabs. The rest
        comes from `tap-target` in the base class set — an invisible
        frame around the button. The tap target matches a finger,
        and screen density stays the same.
      */
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-11 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
