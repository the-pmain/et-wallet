/**
 * Copy, then clear the clipboard.
 *
 * WHY CLEAR. The clipboard is a system-wide area, readable by any
 * app and any page with the read permission. A copied recipient
 * address lives there until the next copy, and a malicious
 * extension reads it and swaps it.
 *
 * THIS IS A MITIGATION, NOT A DEFENSE. Whoever reads the clipboard
 * at the moment of copy will read it anyway: the window between
 * copy and paste always exists. Clearing only shortens the time
 * the value is available.
 *
 * ONLY OUR OWN VALUE IS CLEARED. If the user already copied
 * something else, the clipboard is left alone: wiping someone
 * else's content would destroy data the wallet has no claim on.
 */

const DEFAULT_CLEAR_DELAY_MS = 60_000

export interface ICopyHandle {
  readonly cancel: () => void
}

export interface ICopyOptions {
  readonly clearAfterMs?: number

  /** Clipboard API stand-in. Injected by tests. */
  readonly clipboard?: Pick<Clipboard, 'writeText' | 'readText'>

  /** Scheduler. Injected by tests in place of system timers. */
  readonly schedule?: (handler: () => void, delayMs: number) => () => void
}

/**
 * @throws Error if the clipboard is unavailable — for example the
 *         page is open without a secure connection.
 */
export async function copyWithAutoClear(
  value: string,
  options: ICopyOptions = {},
): Promise<ICopyHandle> {
  const clipboard = options.clipboard ?? navigator.clipboard
  const delay = options.clearAfterMs ?? DEFAULT_CLEAR_DELAY_MS

  const schedule =
    options.schedule ??
    ((handler, delayMs) => {
      const id = globalThis.setTimeout(handler, delayMs)

      return () => {
        globalThis.clearTimeout(id)
      }
    })

  await clipboard.writeText(value)

  const cancel = schedule(() => {
    void clearIfUnchanged(clipboard, value)
  }, delay)

  return { cancel }
}

/**
 * Clear the clipboard if it still holds our value.
 *
 * Reading the clipboard may be denied by the user — then the
 * contents cannot be known, and wiping blindly is also forbidden:
 * someone else's data would be cleared. The refusal is swallowed:
 * a failed clipboard clear must not take down the screen.
 */
async function clearIfUnchanged(
  clipboard: Pick<Clipboard, 'writeText' | 'readText'>,
  expected: string,
): Promise<void> {
  try {
    if ((await clipboard.readText()) === expected) {
      await clipboard.writeText('')
    }
  } catch {
    /* Read is denied or the tab lost focus. A blind clear would
       destroy data the wallet has no claim on. */
  }
}
