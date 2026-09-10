import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  /** Failure message. `null` until a crash. */
  readonly reason: string | null
}

/**
 * Catch of render failures.
 *
 * WHY A WALLET NEEDS THIS. An unhandled React error unmounts the
 * whole tree: the user sees a white screen. For the owner of funds
 * a blank screen is indistinguishable from money gone — and in fact
 * nothing happened: keys are encrypted on disk, the seed phrase is
 * intact, on-chain transactions do not depend on what the browser
 * drew.
 *
 * SO THE FAILURE SCREEN SAYS EXACTLY THAT. "Something went wrong"
 * is useless here: it does not answer the only question that arises
 * — are the funds intact.
 *
 * THE CAUSE IS SHOWN VERBATIM. Without it the owner cannot tell
 * whether the crash repeats, or report it. The error text holds no
 * secrets: keys and the phrase never go into messages, and if they
 * did that would be a separate, far more serious fault.
 *
 * A CLASS COMPONENT IS THE ONLY WAY. Catching render errors is
 * available only through `componentDidCatch`; React has no hook
 * with that capability.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { reason: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { reason: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* The only place in the app where a console write is justified:
       otherwise failure details vanish with the component tree. */
    console.error('Rendering failure', error, info.componentStack)
  }

  override render(): ReactNode {
    const { reason } = this.state

    if (reason === null) {
      return this.props.children
    }

    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold">The application stopped</h1>

        <p className="text-sm">
          Your funds are safe. The failure happened in the wallet interface and touches neither the
          keys, nor the seed phrase, nor anything already written to the blockchain: they are stored
          separately from what is drawn on the screen.
        </p>

        <p className="text-sm">
          Reload the page. If the failure repeats, the state of your address can always be checked
          in a block explorer — the wallet is not needed for that.
        </p>

        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">What the browser reported</span>
          <span className="font-mono text-xs break-all">{reason}</span>
        </div>

        <button
          type="button"
          className="focus-ring h-10 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
          onClick={() => {
            globalThis.location.reload()
          }}
        >
          Reload
        </button>

        <p className="text-xs text-muted-foreground">
          The seed phrase is not needed to reload: the wallet opens with the same password.
        </p>
      </div>
    )
  }
}
