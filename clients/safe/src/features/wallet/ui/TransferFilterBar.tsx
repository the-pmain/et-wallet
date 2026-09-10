import { Search, X } from 'lucide-react'
import { useId } from 'react'

import { Button, Input, Label, SegmentedControl } from '@/shared/ui'

import {
  DIRECTION_FILTER,
  TRANSFER_CATEGORY,
  type DirectionFilter,
  type ITransferFilter,
  type TransferCategory,
} from '../lib/transfer-filter'

interface TransferFilterBarProps {
  readonly filter: ITransferFilter
  readonly onChange: (filter: ITransferFilter) => void

  /** Native-currency symbol of the active chain. Inserted into the category name. */
  readonly nativeSymbol: string | null
}

/**
 * History-record filter controls.
 *
 * State lives outside. The component remembers nothing: the screen
 * owns the conditions and passes them back. That lets the filter be
 * tested without a render and keeps two places from disagreeing on
 * what is selected.
 *
 * The query goes neither into the URL nor into storage. It holds a
 * counterparty address — enough to reconstruct the owner's circle.
 * The URL is kept in browser history and is visible to extensions.
 */
export function TransferFilterBar({ filter, onChange, nativeSymbol }: TransferFilterBarProps) {
  const searchId = useId()

  const categories: readonly { value: TransferCategory; label: string }[] = [
    { value: TRANSFER_CATEGORY.All, label: 'All' },
    { value: TRANSFER_CATEGORY.Native, label: nativeSymbol ?? 'Currency' },
    { value: TRANSFER_CATEGORY.Erc20, label: 'Tokens' },
    { value: TRANSFER_CATEGORY.Nft, label: 'NFT' },
  ]

  /* Direction and category both have an "All" value. The visible
     label is short — extension windows are tight — but the accessible
     name must be distinct: two buttons named "All" are
     indistinguishable to a listener. */
  const directions: readonly { value: DirectionFilter; label: string; name?: string }[] = [
    { value: DIRECTION_FILTER.All, label: 'All', name: 'All directions' },
    { value: DIRECTION_FILTER.Incoming, label: 'Incoming' },
    { value: DIRECTION_FILTER.Outgoing, label: 'Outgoing' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Label htmlFor={searchId} className="sr-only">
          Search the history
        </Label>

        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />

        <Input
          id={searchId}
          value={filter.query}
          placeholder="Address, hash, token symbol"
          autoComplete="off"
          className="pr-10 pl-9"
          onChange={(event) => {
            onChange({ ...filter, query: event.target.value })
          }}
        />

        {filter.query === '' ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear the search"
            className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
            onClick={() => {
              onChange({ ...filter, query: '' })
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {/* Two sets are two segmented controls, not seven buttons.
          They used to be two framed button rows, and "these four are
          one thing, these three another" had to be inferred from
          layout. Worse, "All" appears in both sets and the set
          legends were `sr-only`: only a listener got the group name.
          A shared track and a visible legend fix that.

          On a wide screen the sets sit side by side: two full-width
          rows pushed the list down, and the list is the point. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <SegmentedControl
          className="sm:flex-1"
          legend="Kind of asset"
          options={categories}
          value={filter.category}
          onChange={(category) => {
            onChange({ ...filter, category })
          }}
        />

        <SegmentedControl
          className="sm:flex-1"
          legend="Transfer direction"
          options={directions}
          value={filter.direction}
          onChange={(direction) => {
            onChange({ ...filter, direction })
          }}
        />
      </div>
    </div>
  )
}
