import type { CSSProperties } from 'react'
import { NavigationType, Outlet, useLocation, useNavigationType } from 'react-router'

import { cn } from '@/shared/lib/utils'

import { COINS, type ICoin } from './coins'

/**
 * Shell for sign-in screens.
 *
 * Shared live background for welcome, create, restore, unlock, and
 * reset. Lifted into a route layout instead of being copied on every
 * page: five copies would drift, and navigating between screens would
 * restart the animation from zero — motion would read as a jump.
 *
 * THIS BACKGROUND IS NOT BEHIND THE WALLET PANEL. Motion behind
 * amounts and warnings gets in the way of reading and steals
 * attention. Sign-in screens are the only place with no figure the
 * user is responsible for with money, and decoration is appropriate.
 */
export function AuthLayout() {
  const location = useLocation()
  const navigationType = useNavigationType()

  /* Navigation direction: "back" brings content in from the left,
     "forward" from the right. Matching animation direction to history
     direction is what makes the transition understandable, not merely
     smooth.

     Compared through the library enum, not a string: a string literal
     is not checked by the compiler, and a typo would make every
     transition go the same way. */
  const isBackwards = navigationType === NavigationType.Pop

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <AuroraBackground />

      {/*
        A key on the path restarts the animation on every navigation.
        The background stays put: only the content changes, and the
        change reads as a continuation of one screen, not a new load.
      */}
      <div
        key={location.pathname}
        className={cn(
          'relative z-10 animate-in duration-500 fade-in',
          isBackwards ? 'slide-in-from-left-8' : 'slide-in-from-right-8',
        )}
      >
        <Outlet />
      </div>
    </div>
  )
}

/**
 * Live background: gradient blobs, falling coins, grid, and vignette.
 *
 * Markup is empty on purpose: all look lives in CSS, and the elements
 * here are only layers. `aria-hidden` is required: a screen reader
 * has nothing to say about a background, and extra nodes clutter
 * navigation.
 */
function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden>
      <div className="aurora-blob aurora-blob-primary" />
      <div className="aurora-blob aurora-blob-secondary" />
      <div className="aurora-blob aurora-blob-accent" />

      <CoinRain />

      <div className="aurora-grid" />
      <div className="aurora-vignette" />
    </div>
  )
}

/**
 * Slowly falling coins.
 *
 * WHY CSS, NOT CANVAS. A canvas needs a continuous loop on the main
 * thread: while the wallet is open, the CPU is busy redrawing
 * decoration. Here only `transform` is animated, and the browser
 * does that on the GPU without waking the main thread at all.
 *
 * WHY POSITIONS ARE A LIST, NOT RANDOM. `Math.random` would give a
 * different picture on every render: tests would become
 * non-deterministic, and the layout itself would sometimes pile up.
 * Values are chosen so coins spread across the width and do not
 * share a phase.
 *
 * The layer is hidden entirely under the reduced-motion setting —
 * see `index.css`. Turning off animation alone is not enough: coins
 * would freeze in a visible heap at the bottom edge.
 */
function CoinRain() {
  return (
    <div className="coin-rain">
      {COINS.map((coin, index) => (
        <span key={index} className="coin" style={coinStyle(coin)} />
      ))}
    </div>
  )
}

/**
 * Style of one coin.
 *
 * CSS custom properties are not part of `CSSProperties`, so the type
 * is extended explicitly. Casting to `any` would solve the same
 * problem and also disable checking of the other fields — a typo in
 * `animationDuration` would show as nothing but a motionless coin.
 */
type CoinStyle = CSSProperties & {
  readonly '--coin-drift': string
  readonly '--coin-opacity': string
  readonly '--coin-spin': string
}

function coinStyle(coin: ICoin): CoinStyle {
  return {
    left: `${String(coin.left)}%`,
    width: `${String(coin.size)}px`,
    height: `${String(coin.size)}px`,
    animationDuration: `${String(coin.duration)}s`,
    animationDelay: `${String(coin.delay)}s`,
    '--coin-drift': `${String(coin.drift)}px`,
    '--coin-opacity': String(coin.opacity),
    '--coin-spin': `${String(coin.spin)}deg`,
  }
}
