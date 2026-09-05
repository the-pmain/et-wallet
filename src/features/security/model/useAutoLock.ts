import { AutoLockService, type IClock } from '@/core'
import { useEffect, useMemo, useState } from 'react'

/**
 * Browser events treated as a sign the user is present.
 *
 * Pointer move is left out on purpose: the cursor moves from an
 * accidental bump of the desk, and auto-lock extended by that
 * would never fire on a laptop left open.
 */
const ACTIVITY_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']

export interface IAutoLockState {
  readonly isWarning: boolean

  /** Time left until lock. `null` while the countdown is not running. */
  readonly remainingMs: number | null

  readonly extend: () => void
}

export interface IUseAutoLockParams {
  /** The countdown runs only on an unlocked wallet. */
  readonly isUnlocked: boolean

  readonly timeoutMs: number
  readonly clock: IClock

  readonly onExpire: () => void
}

/**
 * Wire auto-lock to the browser.
 *
 * THE CORE COUNTS TIME; THIS HOOK LISTENS TO THE BROWSER. The split
 * keeps `AutoLockService` usable in a service worker, where there is
 * no DOM and no input events.
 *
 * MOVING THE TAB TO THE BACKGROUND COUNTS AS IDLE, NOT ACTIVITY.
 * The opposite reading would extend the session on every window
 * switch — exactly when the user walked away from the wallet.
 *
 * EVENTS ARE LISTENED IN THE CAPTURE PHASE. A handler that stopped
 * bubbling would otherwise cancel the session extension, and the
 * wallet would lock mid-work.
 */
export function useAutoLock({
  isUnlocked,
  timeoutMs,
  clock,
  onExpire,
}: IUseAutoLockParams): IAutoLockState {
  const service = useMemo(() => new AutoLockService({ clock }, { timeoutMs }), [clock, timeoutMs])

  const [isWarning, setWarning] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  useEffect(() => {
    if (!isUnlocked) {
      /* State is not reset here: a synchronous `setState` in the
         effect body causes a cascading render. Reset is done by the
         previous run's cleanup — it runs before this branch. */
      service.stop()

      return
    }

    const unsubscribeWarning = service.on('autolock:warning', ({ remainingMs: left }) => {
      setWarning(true)
      setRemainingMs(left)
    })

    const unsubscribeResumed = service.on('autolock:resumed', () => {
      setWarning(false)
      setRemainingMs(null)
    })

    const unsubscribeExpired = service.on('autolock:expired', () => {
      setWarning(false)
      setRemainingMs(null)
      onExpire()
    })

    const handleActivity = (): void => {
      service.notifyActivity()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { capture: true, passive: true })
    }

    service.start()

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity, { capture: true })
      }

      unsubscribeWarning()
      unsubscribeResumed()
      unsubscribeExpired()
      service.stop()

      /* The warning is cleared with the countdown: otherwise it would
         pop up right after the next unlock, while a full timeout
         remains. */
      setWarning(false)
      setRemainingMs(null)
    }
  }, [isUnlocked, service, onExpire])

  return {
    isWarning,
    remainingMs,
    extend: () => {
      service.notifyActivity()
    },
  }
}
