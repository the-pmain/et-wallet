import type { Address, ChainId } from '@/core'
import { cn } from '@/shared/lib/utils'

import { findTokenLogo } from '../lib/token-logo'

interface TokenAvatarProps {
  /** Contract address. `null` for native currency. */
  readonly address: string | null

  /** Token symbol. The first letters become the monogram. */
  readonly symbol: string

  /**
   * Chain the contract lives on.
   *
   * Without it the mark is not looked up at all: the same address on
   * different chains is different contracts, and a mark granted by
   * address alone could go to someone else's token.
   */
  readonly chainId?: ChainId | null

  readonly className?: string
}

/**
 * Token mark.
 *
 * Why a live logo is not loaded. Three independent reasons, each
 * enough on its own.
 *
 * First — CSP. Production allows images only from our build and
 * `data:`. A third-party logo host would be blocked, and weakening
 * the policy for decoration is not allowed.
 *
 * Second — privacy. The set of requested logos tells the host the
 * user's portfolio and ties it to an IP. A wallet built around
 * non-disclosure cannot open that leak for a picture.
 *
 * Third — fakes. A fraudulent contract with ticker `USDC` and the
 * real USDC logo is indistinguishable from the original.
 *
 * What changed. The first two still forbid a network fetch; marks
 * now live in the build, so no third-party request happens.
 *
 * The third flips if the mark is granted by (chain, contract)
 * checked against the built-in registry, not by ticker. Real USDC
 * gets the mark; a fake with the same ticker does not. The mark
 * became an authenticity signal instead of bait. See
 * `findTokenLogo`.
 *
 * Other tokens keep an address fingerprint: color is derived from
 * the address, the contract author cannot pick it, and two
 * different contracts look different even with matching tickers.
 */
export function TokenAvatar({ address, symbol, chainId, className }: TokenAvatarProps) {
  const hue = address === null ? NATIVE_HUE : hashAddress(address) % 360
  const monogram = symbol.trim().slice(0, 3).toUpperCase()
  const logo = findTokenLogo(chainId ?? null, (address as Address | null) ?? null)

  if (logo !== null) {
    /* `object-contain` is required: three of eight marks are not
       square (ether diamond, Tether, POL). A square frame without
       it would stretch them, and a stretched brand mark is worse
       than none.

       Empty alt, not the coin name: ticker and name already sit
       as text in the same row; voicing them twice is noise.

       Size is set by attributes: without them the list row jumped
       when the mark appeared. Lazy load is unnecessary — the file
       is in our build and is about a kilobyte. */
    const common = cn('size-9 shrink-0 object-contain', className)

    if (logo.srcOnDark === null) {
      return <img src={logo.src} alt="" aria-hidden width={36} height={36} className={common} />
    }

    /* Two images instead of picking the theme in code: the theme
       switches by a class on the root, and the CSS rule depends on
       neither state nor paint order. */
    return (
      <>
        <img
          src={logo.src}
          alt=""
          aria-hidden
          width={36}
          height={36}
          className={cn(common, 'dark:hidden')}
        />
        <img
          src={logo.srcOnDark}
          alt=""
          aria-hidden
          width={36}
          height={36}
          className={cn(common, 'hidden dark:block')}
        />
      </>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
        className,
      )}
      style={{
        background: `oklch(0.32 0.09 ${String(hue)})`,
        color: `oklch(0.85 0.13 ${String((hue + 40) % 360)})`,
      }}
    >
      {monogram === '' ? '?' : monogram}
    </span>
  )
}

/**
 * Native-currency hue.
 *
 * Fixed and matching the brand: native currency is part of the
 * network config, not an arbitrary contract, so a constant color
 * is appropriate.
 */
const NATIVE_HUE = 293

/**
 * Fold the address into a number.
 *
 * FNV-1a: deterministic, mixes short strings well. Cryptographic
 * strength is neither required nor implied — only color
 * distinctness. Do not reuse this hash for anything else.
 */
function hashAddress(address: string): number {
  const normalized = address.toLowerCase()

  let hash = 0x811c9dc5

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}
