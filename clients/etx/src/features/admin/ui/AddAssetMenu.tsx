import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { IRemoteAssetToken } from '@/features/onboarding/model/RemoteUserDirectory'
import { TokenAvatar } from '@/features/wallet/ui/TokenAvatar'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui'

import { ADDABLE_ASSETS, remoteAssetKey } from '../model/addable-assets'

interface AddAssetMenuProps {
  readonly existing: readonly IRemoteAssetToken[]
  readonly disabled: boolean
  readonly onAdd: (token: IRemoteAssetToken) => void
}

/**
 * Меню добавления криптовалюты в витрину записи.
 *
 * СПИСОК ОТКРЫВАЕТСЯ ПО НАЖАТИЮ, А НЕ ПО НАВЕДЕНИЮ. Наведение на шапке
 * срабатывает мимоходом, и кабинет тогда сам вываливал бы длинный
 * перечень. Клик — намерение.
 *
 * ЗНАК СТОИТ В КАЖДОЙ СТРОКЕ. Это те же файлы, что в кошельке: пара
 * «сеть и адрес» из встроенного реестра, а не картинка по тикеру.
 */
export function AddAssetMenu({ existing, disabled, onAdd }: AddAssetMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const taken = useMemo(() => new Set(existing.map((token) => remoteAssetKey(token))), [existing])

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

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <Plus />
        Add crypto
        <ChevronDown
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </Button>

      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label="Cryptocurrencies"
          className="absolute top-full right-0 z-30 mt-2 max-h-80 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-border/70 bg-card py-1 shadow-surface"
        >
          {ADDABLE_ASSETS.map((item) => {
            const already = taken.has(item.id)
            const label = already
              ? `${item.token.symbol} on ${item.chainName} already added`
              : `Add ${item.token.symbol} on ${item.chainName}`

            return (
              <li key={item.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={already}
                  aria-label={label}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 px-3 py-2 text-left',
                    already ? 'cursor-default opacity-55' : 'cursor-pointer hover:bg-accent',
                  )}
                  onClick={() => {
                    if (already) {
                      return
                    }

                    onAdd(item.token)
                    setOpen(false)
                  }}
                >
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
                  {already ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
