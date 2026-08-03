import { Search, X } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/shared/lib/utils'
import { Button, Input, Label } from '@/shared/ui'

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

  /** Символ нативной валюты активной сети. Подставляется в название категории. */
  readonly nativeSymbol: string | null
}

/**
 * Управление отбором записей истории.
 *
 * СОСТОЯНИЕ ЖИВЁТ СНАРУЖИ. Компонент ничего не помнит: экран владеет
 * условиями и передаёт их обратно. Это позволяет проверить отбор без
 * рендера и не даёт двум местам расходиться в том, что сейчас выбрано.
 *
 * ЗАПРОС НЕ ПОПАДАЕТ НИ В АДРЕСНУЮ СТРОКУ, НИ В ХРАНИЛИЩЕ. Он содержит
 * адрес контрагента — сведения, по которым восстанавливается круг
 * общения владельца кошелька. Адресная строка сохраняется в истории
 * браузера и доступна расширениям.
 */
export function TransferFilterBar({ filter, onChange, nativeSymbol }: TransferFilterBarProps) {
  const searchId = useId()

  const categories: readonly { value: TransferCategory; label: string }[] = [
    { value: TRANSFER_CATEGORY.All, label: 'All' },
    { value: TRANSFER_CATEGORY.Native, label: nativeSymbol ?? 'Currency' },
    { value: TRANSFER_CATEGORY.Erc20, label: 'Tokens' },
    { value: TRANSFER_CATEGORY.Nft, label: 'NFT' },
  ]

  /* У направления и категории есть значение «Все». Видимая надпись
     короткая — места в окне расширения мало, — но доступное имя обязано
     быть различимым: две кнопки с именем «Все» неразличимы для того,
     кто слушает страницу, а не смотрит на неё. */
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

      <fieldset>
        <legend className="sr-only">Kind of asset</legend>
        <div className="grid grid-cols-4 gap-2">
          {categories.map((item) => (
            <SegmentButton
              key={item.value}
              label={item.label}
              isSelected={filter.category === item.value}
              onSelect={() => {
                onChange({ ...filter, category: item.value })
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="sr-only">Transfer direction</legend>
        <div className="grid grid-cols-3 gap-2">
          {directions.map((item) => (
            <SegmentButton
              key={item.value}
              label={item.label}
              name={item.name}
              isSelected={filter.direction === item.value}
              onSelect={() => {
                onChange({ ...filter, direction: item.value })
              }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  )
}

interface SegmentButtonProps {
  readonly label: string

  /** Доступное имя, если видимой надписи для различения недостаточно. */
  readonly name?: string | undefined

  readonly isSelected: boolean
  readonly onSelect: () => void
}

/**
 * Кнопка выбора одного значения из набора.
 *
 * Выбранное состояние передаётся через `aria-pressed`, а не только
 * цветом: цвет как единственный признак недоступен людям с нарушением
 * цветовосприятия и не читается вспомогательными технологиями.
 */
function SegmentButton({ label, name, isSelected, onSelect }: SegmentButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={name}
      onClick={onSelect}
      className={cn(
        'truncate rounded-xl border px-2 py-2 text-xs font-medium transition-colors',
        isSelected
          ? 'border-primary bg-primary/10 text-primary-emphasis'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}
