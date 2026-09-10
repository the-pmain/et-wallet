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

      {/* ДВА НАБОРА — ДВА ОТДЕЛЬНЫХ ПЕРЕКЛЮЧАТЕЛЯ, А НЕ СЕМЬ КНОПОК.
          Прежде они шли двумя рядами кнопок в рамках, и связь «эти
          четыре про одно, эти три про другое» приходилось выводить из
          расположения. Хуже того, слово «All» встречается в обоих
          наборах, а подписи наборов были скрыты в `sr-only`: имя набора
          получал только слушающий страницу, зрячий — семь кнопок без
          объяснения. Общая дорожка и видимая подпись это чинят.

          На широком экране наборы встают рядом: два ряда во всю ширину
          отодвигали сам список вниз, а он здесь главный. */}
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
