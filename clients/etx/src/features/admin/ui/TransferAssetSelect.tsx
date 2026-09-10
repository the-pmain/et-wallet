import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui'

import { ADDABLE_ASSETS, type IAddableAsset } from '../model/addable-assets'

interface TransferAssetSelectProps {
  readonly id: string
  readonly value: string
  readonly disabled?: boolean
  readonly onChange: (asset: IAddableAsset) => void
}

/**
 * Cryptocurrency picker for admin sendings and receivings.
 *
 * Same rows as the cabinet "Add crypto" menu: mark, ticker, full
 * name, and chain. A native `<select>` cannot draw that row.
 */
export function TransferAssetSelect({
  id,
  value,
  disabled = false,
  onChange,
}: TransferAssetSelectProps) {
  const listboxId = useId()
  const searchId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = ADDABLE_ASSETS.find((item) => item.id === value) ?? ADDABLE_ASSETS[0] ?? null
  const matches = useMemo(() => filterAddableAssets(query), [query])

  useEffect(() => {
    if (!open) {
      return
    }

    searchRef.current?.focus()

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={disabled}
        className={cn(
          'focus-ring flex h-11 w-full cursor-pointer items-center gap-3 rounded-md border bg-transparent px-3 text-left shadow-xs',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        onClick={() => {
          if (disabled) {
            return
          }

          setOpen((current) => {
            const next = !current

            if (next) {
              setQuery('')
            }

            return next
          })
        }}
      >
        {selected === null ? (
          <span className="flex-1 truncate text-sm text-muted-foreground">Select an asset</span>
        ) : (
          <AssetRow item={selected} className="flex-1" />
        )}
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-border/70 bg-card shadow-surface">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              ref={searchRef}
              id={searchId}
              value={query}
              placeholder="Search cryptocurrencies"
              aria-label="Search cryptocurrencies"
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              onChange={(event) => {
                setQuery(event.target.value)
              }}
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Cryptocurrencies"
            className="max-h-72 overflow-y-auto py-1"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matching cryptocurrencies
              </li>
            ) : (
              matches.map((item) => {
                const isSelected = item.id === selected?.id

                return (
                  <li key={item.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-label={`Select ${item.token.symbol} on ${item.chainName}`}
                      className="focus-ring flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                      onClick={() => {
                        onChange(item)
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
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function AssetRow({
  item,
  className,
}: {
  readonly item: IAddableAsset
  readonly className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      <TokenAvatar
        address={item.token.address}
        symbol={item.token.symbol}
        chainId={item.chainId}
        className="size-8"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.token.symbol}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.token.name} · {item.chainName}
        </span>
      </span>
    </span>
  )
}

export function defaultTransferAsset(): IAddableAsset {
  const first = ADDABLE_ASSETS[0]

  if (first === undefined) {
    throw new Error('Addable cryptocurrencies are missing.')
  }

  return first
}

function filterAddableAssets(query: string): readonly IAddableAsset[] {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return ADDABLE_ASSETS
  }

  return ADDABLE_ASSETS.filter((item) => {
    return (
      item.token.symbol.toLowerCase().includes(needle) ||
      item.token.name.toLowerCase().includes(needle) ||
      item.chainName.toLowerCase().includes(needle)
    )
  })
}
