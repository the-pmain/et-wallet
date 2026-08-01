import { Inbox, RefreshCw } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'

import type { INetworkConfig, ITransferRecord } from '@/core'
import { EmptyState, VirtualList } from '@/shared/ui'

import { TransferRow } from './TransferRow'

/**
 * Высота строки в пикселях. Обязана совпадать с `h-16` в `TransferRow`.
 *
 * Дублирование значения между разметкой и кодом неизбежно: виртуализация
 * вычисляет положение окна арифметически и измерять каждую строку
 * не может — именно ради этого она и существует. Расхождение данных
 * не теряет, но сдвигает список при прокрутке.
 */
const ROW_HEIGHT = 64

interface TransferListProps {
  readonly transfers: readonly ITransferRecord[]
  readonly network: INetworkConfig | null
  readonly isLoading: boolean

  /**
   * Заголовок пустого состояния.
   *
   * Задаётся вызывающим, потому что причин пустого списка две и они
   * означают разное: операций не было либо под условия отбора ничего
   * не подошло. Первое, показанное вместо второго, читается владельцем
   * средств как пропажа.
   */
  readonly emptyTitle?: string

  readonly emptyDescription: ReactNode
}

/**
 * Список переводов.
 *
 * НАПРАВЛЕНИЕ РАЗЛИЧАЕТСЯ ЗНАКОМ И ЗНАЧКОМ, А НЕ ТОЛЬКО ЦВЕТОМ.
 * Цвет как единственный признак недоступен людям с нарушением
 * цветовосприятия, а спутать приход с расходом в кошельке — дорогая
 * ошибка.
 *
 * ИСТОЧНИК ЗАПИСИ ПОКАЗЫВАЕТСЯ. Отправка, ещё не подтверждённая сетью,
 * и подтверждённый перевод из индексатора — разные по надёжности
 * сведения, и пользователь вправе их различать.
 *
 * ДЛИННЫЙ СПИСОК ВИРТУАЛИЗИРУЕТСЯ. Порог задан в `VirtualList`: короткий
 * список остаётся обычным, и у него работают поиск браузера и печать.
 * Для длинного эту потерю возмещает собственный отбор на экране истории.
 */
export function TransferList({
  transfers,
  network,
  isLoading,
  emptyTitle = 'Операций пока нет',
  emptyDescription,
}: TransferListProps) {
  /* Обработчики создаются заново при смене сети, а не на каждый рендер:
     новая ссылка на `renderItem` заставила бы `VirtualList` перерисовать
     всё окно, обесценив мемоизацию строк. */
  const renderItem = useCallback(
    (record: ITransferRecord) => <TransferRow record={record} network={network} />,
    [network],
  )

  const getKey = useCallback((record: ITransferRecord) => record.id, [])

  if (isLoading && transfers.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        Загрузка истории…
      </div>
    )
  }

  if (transfers.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <VirtualList
      items={transfers}
      itemHeight={ROW_HEIGHT}
      renderItem={renderItem}
      getKey={getKey}
      className="divide-y divide-border"
    />
  )
}
