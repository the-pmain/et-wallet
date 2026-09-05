import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui'

import { copyWithAutoClear, type ICopyHandle } from '../model/clipboard'

interface SecretRevealProps {
  /** What is shown. Goes into the label, not the clipboard. */
  readonly label: string

  /** The value itself. The string cannot be wiped — see below. */
  readonly value: string

  readonly canCopy?: boolean
}

/**
 * Show a secret on one line — a private key, an extended key.
 *
 * HONESTY BOUNDARY. A shown secret exists as a string in the React
 * tree and in tab memory. JavaScript strings cannot be wiped: the
 * value lives until garbage collection, and that cannot be fixed.
 * Mitigations are exactly two — the value is hidden until an
 * explicit user action, and the clipboard clears itself.
 *
 * HIDDEN BY DEFAULT. A screen that opens with the key already
 * visible reveals it to a glance over the shoulder, a screen share,
 * and a screenshot taken without looking.
 */
export function SecretReveal({ label, value, canCopy = true }: SecretRevealProps) {
  const [isRevealed, setRevealed] = useState(false)
  const [isCopied, setCopied] = useState(false)

  /* Cancel a scheduled clear when leaving the screen: a timer
     that outlived the component would touch the clipboard of a
     tab already showing something else. */
  const copyHandle = useRef<ICopyHandle | null>(null)

  useEffect(() => {
    return () => {
      copyHandle.current?.cancel()
      copyHandle.current = null
    }
  }, [])

  const copy = async () => {
    copyHandle.current?.cancel()
    copyHandle.current = await copyWithAutoClear(value)
    setCopied(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>

      <p
        className={cn(
          'rounded-lg border bg-muted px-3 py-2 font-mono text-xs break-all',
          !isRevealed && 'blur-sm select-none',
        )}
        aria-hidden={!isRevealed}
      >
        {value}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRevealed((current) => !current)
          }}
        >
          {isRevealed ? <EyeOff /> : <Eye />}
          {isRevealed ? 'Hide' : 'Show'}
        </Button>

        {canCopy && isRevealed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void copy()
            }}
          >
            {isCopied ? <Check /> : <Copy />}
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>

      {canCopy && isRevealed && (
        <p className="text-xs text-muted-foreground">
          The clipboard is available to other applications. The copied value is cleared after a
          minute unless you copy something else.
        </p>
      )}
    </div>
  )
}
