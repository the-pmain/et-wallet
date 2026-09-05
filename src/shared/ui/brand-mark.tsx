import { cn } from '@/shared/lib/utils'

interface BrandMarkProps {
  readonly className?: string
  /**
   * Caption for the mark. An empty string means the mark is decorative:
   * a visible name already sits beside it, and repeating “ETWallet” in
   * a screen reader would be noise.
   */
  readonly alt?: string
}

/**
 * Intrinsic size of the source file in pixels.
 *
 * Set on `width` and `height` so the browser reserves space before the
 * image loads. Without that the screen jumps when the mark appears.
 */
const INTRINSIC_SIZE = 128

/**
 * ETWallet brand mark.
 *
 * THE MARK WITHOUT LETTERING IS USED. The full logo lockup contains
 * the word “Wallet” in dark blue (rgb 50, 54, 75). On the dark theme
 * (rgb 38, 33, 48) it is nearly invisible, so the full lockup is only
 * fit for light surfaces — a storefront, documents, print.
 *
 * FILE SIZE. The source mark is 1024×1024 and about 1.4 MB. This uses
 * a prepared 128×128 variant of about 13 KB: downloading a megabyte
 * and a half for a 56-pixel square is not acceptable. Size variants
 * are produced by `npm run icons`.
 *
 * THE MARK HELPS AGAINST PHISHING. A recognizable look is a weak but
 * real barrier to a fake copy: a user used to a specific mark notices
 * a swap. So it is the same on every screen and is not replaced by
 * arbitrary icons.
 */
export function BrandMark({ className, alt = 'ETWallet' }: BrandMarkProps) {
  return (
    <img
      src="/icons/icon-128.png"
      width={INTRINSIC_SIZE}
      height={INTRINSIC_SIZE}
      alt={alt}
      /* The mark is visible as soon as the app opens, so there is
         nothing to defer: lazy loading here would only flash on
         the first screen. */
      loading="eager"
      decoding="async"
      draggable={false}
      className={cn('size-8 select-none', className)}
    />
  )
}
