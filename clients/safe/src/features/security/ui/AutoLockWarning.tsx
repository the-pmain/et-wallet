import { Clock } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

interface AutoLockWarningProps {
  readonly isVisible: boolean
  readonly remainingMs: number | null
  readonly onExtend: () => void
}

/**
 * Warning that auto-lock is about to fire.
 *
 * WHY IT EXISTS. A lock mid-send-form loses the input and, without
 * explanation, looks like a crash. The warning lets the session be
 * extended with one click and names the reason if the person
 * stepped away and came back to the password screen.
 *
 * IT DOES NOT CANCEL THE LOCK. An ignored warning still lets the
 * deadline expire: otherwise doing nothing would be enough, and
 * the protection would become optional.
 */
export function AutoLockWarning({ isVisible, remainingMs, onExtend }: AutoLockWarningProps) {
  if (!isVisible) {
    return null
  }

  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000)

  return (
    <Alert variant="warning" className="sticky top-2 z-30">
      <Clock />
      <AlertTitle>The wallet is about to lock</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          {seconds === null
            ? 'You have been inactive, and the session is about to close.'
            : `You have been inactive. The session closes in about ${String(seconds)} s.`}{' '}
          Your funds are not affected: only access closes, and the password brings it back.
        </span>

        <Button size="sm" onClick={onExtend}>
          Stay in the wallet
        </Button>
      </AlertDescription>
    </Alert>
  )
}
