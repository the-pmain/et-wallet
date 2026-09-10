import { EyeOff, Languages } from 'lucide-react'

import { toSafeText } from '@/core'
import { cn } from '@/shared/lib/utils'

interface UntrustedTextProps {
  /** A string from a contract, a network config, or a third-party service. */
  readonly value: string

  readonly className?: string
}

/**
 * Display a string we did not write.
 *
 * WHAT THESE STRINGS ARE. A token symbol and name are set by the
 * contract author. A network name is set by whoever added it.
 * Notification text comes from a lookup service. All sit next to
 * amounts and addresses, and all can hold invisible characters or
 * a reversed writing direction.
 *
 * HIDDEN CHARACTERS ARE REPLACED WITH A MARKER, AND THE STRING IS
 * FLAGGED. Silent deletion would make a forgery indistinguishable
 * from the original — exactly what its author wanted. The icon
 * means: this string contained something you cannot see.
 *
 * MIXED SCRIPTS ARE FLAGGED SEPARATELY. There are no hidden
 * characters in such a name — ordinary visible letters, just from
 * different alphabets: `Aave` with a Cyrillic A (U+0410) looks perfect.
 * A network name is checked against built-ins, a token symbol
 * against the verified list, and an app name has nothing to check
 * against: nobody attested it. Mix is the only signal, and it is
 * shown as-is.
 */
export function UntrustedText({ value, className }: UntrustedTextProps) {
  const safe = toSafeText(value)

  if (!safe.hasHiddenCharacters && !safe.hasMixedScripts) {
    return <span className={className}>{safe.text}</span>
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-risk-high', className)}>
      {safe.text}

      {safe.hasHiddenCharacters ? (
        <EyeOff
          className="size-3.5 shrink-0"
          aria-label="The string contained hidden characters — it may be a forgery"
        />
      ) : (
        <Languages
          className="size-3.5 shrink-0"
          aria-label="The name mixes alphabets — it may imitate a familiar one"
        />
      )}
    </span>
  )
}
