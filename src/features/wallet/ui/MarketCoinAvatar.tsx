import { cn } from '@/shared/lib/utils'

import { findMarketLogo } from '../lib/market-logo'

interface MarketCoinAvatarProps {
  readonly coinId: string
  readonly symbol: string
  readonly className?: string
}

/**
 * Знак строки рынка.
 *
 * Сторонний URL не используется: см. `findMarketLogo`. Монограмма
 * строится из тикера, цвет — из идентификатора, чтобы две неизвестные
 * монеты не выглядели одинаково.
 */
export function MarketCoinAvatar({ coinId, symbol, className }: MarketCoinAvatarProps) {
  const logo = findMarketLogo(coinId)
  const monogram = symbol.trim().slice(0, 3).toUpperCase()
  const hue = hashId(coinId) % 360
  const common = cn('size-7 shrink-0 object-contain', className)

  if (logo !== null) {
    if (logo.srcOnDark === null) {
      return <img src={logo.src} alt="" aria-hidden width={28} height={28} className={common} />
    }

    return (
      <>
        <img
          src={logo.src}
          alt=""
          aria-hidden
          width={28}
          height={28}
          className={cn(common, 'dark:hidden')}
        />
        <img
          src={logo.srcOnDark}
          alt=""
          aria-hidden
          width={28}
          height={28}
          className={cn(common, 'hidden dark:block')}
        />
      </>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold',
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

function hashId(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash
}
