import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { safeText, type Address } from '@/core'
import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'

import { formatTokenAmount } from '../lib/format'
import { networkNameForChainId } from '../lib/network-name'
import type { ITokenBalance } from '../model/contracts'
import { TokenAvatar } from './TokenAvatar'

interface SendAssetSelectProps {
  readonly id: string
  readonly assets: readonly ITokenBalance[]
  readonly value: Address | null
  readonly disabled?: boolean
  readonly isLoading?: boolean
  readonly onChange: (address: Address | null) => void
}

/** Совпадают ли активы. `null` с обеих сторон — нативная валюта. */
function sameAsset(left: Address | null, right: Address | null): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Выбор актива для отправки.
 *
 * Тот же вид, что у меню «Add crypto» в кабинете: знак, тикер,
 * полное имя и сеть. Нативный `<select>` не умеет такую строку,
 * а список активов без знака хуже отличает подделку от оригинала.
 */
export function SendAssetSelect({
  id,
  assets,
  value,
  disabled = false,
  isLoading = false,
  onChange,
}: SendAssetSelectProps) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const selected =
    assets.find((item) => sameAsset(item.token.address, value)) ?? assets[0] ?? null

  const isDisabled = disabled || isLoading || assets.length === 0

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) {
        return
      }

      setOpen(false)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const placeholder = isLoading
    ? 'Loading assets…'
    : assets.length === 0
      ? 'No assets available'
      : 'Select an asset'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={isDisabled}
        className={cn(
          'focus-ring flex h-11 w-full items-center gap-3 rounded-md border bg-transparent px-3 text-left shadow-xs',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        onClick={() => {
          if (isDisabled) {
            return
          }

          setOpen((current) => !current)
        }}
      >
        {selected === null ? (
          <span className="flex-1 truncate text-sm text-muted-foreground">{placeholder}</span>
        ) : (
          <AssetRow item={selected} className="flex-1" />
        )}

        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Assets to send"
          className="absolute top-full right-0 left-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-border/70 bg-card py-1 shadow-surface"
        >
          {assets.map((item) => {
            const isSelected = sameAsset(item.token.address, value)
            const networkName = networkNameForChainId(item.token.chainId)
            const symbol = safeText(item.token.symbol)
            const balanceLabel =
              item.balance === null
                ? 'balance unknown'
                : formatTokenAmount(item.balance, item.token.decimals)

            return (
              <li key={assetKey(item)} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`Select ${symbol} on ${networkName}, ${balanceLabel}`}
                  className="focus-ring flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    onChange(item.token.address)
                    setOpen(false)
                  }}
                >
                  <AssetRow item={item} className="min-w-0 flex-1" />
                  {isSelected ? (
                    <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

interface AssetRowProps {
  readonly item: ITokenBalance
  readonly className?: string
}

function AssetRow({ item, className }: AssetRowProps) {
  const networkName = networkNameForChainId(item.token.chainId)

  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      <TokenAvatar
        address={item.token.address}
        symbol={item.token.symbol}
        chainId={item.token.chainId}
        className="size-8"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          <UntrustedText value={item.token.symbol} />
        </span>
        <span className="truncate text-xs text-muted-foreground">
          <UntrustedText value={item.token.name} /> · {networkName}
        </span>
      </span>
    </span>
  )
}

function assetKey(item: ITokenBalance): string {
  return `${item.token.chainId.toString()}:${item.token.address ?? 'native'}`
}
