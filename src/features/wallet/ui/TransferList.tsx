import { Inbox, RefreshCw } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'

import type { INetworkConfig, ITransferRecord, TxHash } from '@/core'
import { EmptyState, VirtualList } from '@/shared/ui'

import type { ReplacementKind } from '../lib/replacement'
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

  /**
   * Оформление пустого состояния.
   *
   * Нужно потому, что один и тот же список стоит на двух экранах с
   * разной ценой пустоты. На экране истории пустота — весь смысл
   * экрана, и ей отведено место. На главном экране тот же блок
   * вытеснял бы за нижний край баланс, ради которого экран и открыт.
   */
  readonly emptyClassName?: string | undefined

  /**
   * Начинает замену зависшей отправки.
   *
   * Ссылка обязана быть устойчивой: её смена перерисовывает всё окно
   * виртуального списка и обесценивает мемоизацию строк.
   */
  readonly onReplace?: ((hash: TxHash, kind: ReplacementKind) => void) | undefined
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
  emptyTitle = 'No operations yet',
  emptyDescription,
  emptyClassName,
  onReplace,
}: TransferListProps) {
  /* Обработчики создаются заново при смене сети, а не на каждый рендер:
     новая ссылка на `renderItem` заставила бы `VirtualList` перерисовать
     всё окно, обесценив мемоизацию строк. */
  const renderItem = useCallback(
    (record: ITransferRecord) => (
      <TransferRow record={record} network={network} onReplace={onReplace} />
    ),
    [network, onReplace],
  )

  const getKey = useCallback((record: ITransferRecord) => record.id, [])

  if (isLoading && transfers.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        Loading the history…
      </div>
    )
  }

  if (transfers.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
        className={emptyClassName}
      />
    )
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
