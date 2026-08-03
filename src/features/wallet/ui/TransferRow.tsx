import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react'
import { memo } from 'react'

import {
  TRANSACTION_STATUS,
  TRANSFER_DIRECTION,
  TRANSFER_SOURCE,
  type INetworkConfig,
  type ITransferRecord,
  type TxHash,
} from '@/core'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui'

import { formatTimestamp, shortenAddress } from '../lib/format'
import { REPLACEMENT_KIND, isReplaceable, type ReplacementKind } from '../lib/replacement'
import { describeAmount, describeKind } from '../lib/transfer-display'

interface TransferRowProps {
  readonly record: ITransferRecord
  readonly network: INetworkConfig | null

  /**
   * Начинает замену зависшей отправки.
   *
   * Необязателен: строка используется и там, где заменять нечем, —
   * например в списке чужих переводов.
   */
  readonly onReplace?: ((hash: TxHash, kind: ReplacementKind) => void) | undefined
}

/**
 * Строка списка переводов.
 *
 * ВЫНЕСЕНА ИЗ СПИСКА РАДИ МЕМОИЗАЦИИ. Запись перевода неизменяема
 * и приходит из снимка сессии, который заменяется целиком: при обновлении
 * баланса или курса ссылки на прежние записи сохраняются, и сравнение
 * по ссылке отсекает перерисовку всех строк, кроме изменившихся.
 * Разбор суммы и форматирование времени при этом не выполняются заново.
 *
 * СРАВНЕНИЕ ПО УМОЛЧАНИЮ ДОСТАТОЧНО: обе опоры — объекты, живущие
 * в снимке, и подменять их на равные по значению копии сессия
 * не станет.
 *
 * ВЫСОТА СТРОКИ ФИКСИРОВАНА. Виртуализация считает положение окна
 * умножением на высоту строки, и содержимое переменной высоты сдвигало бы
 * список при прокрутке. Отсюда `h-16` и усечение длинных значений вместо
 * переноса.
 */
export const TransferRow = memo(function TransferRow({
  record,
  network,
  onReplace,
}: TransferRowProps) {
  const isOutgoing = record.direction === TRANSFER_DIRECTION.Outgoing
  const amount = describeAmount(record, network)
  const counterparty = isOutgoing ? record.to : record.from
  const explorer = network?.blockExplorerUrls[0] ?? null
  const canReplace = onReplace !== undefined && isReplaceable(record)

  return (
    <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          isOutgoing ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary-emphasis',
        )}
      >
        {isOutgoing ? (
          <ArrowUpRight className="size-4" aria-hidden />
        ) : (
          <ArrowDownLeft className="size-4" aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm">
          <span className="font-medium">{describeKind(record.kind)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {counterparty === null ? '—' : shortenAddress(counterparty)}
          </span>
        </span>

        <span className="flex flex-nowrap items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          {record.timestamp === null
            ? `Block ${record.blockNumber.toString()}`
            : formatTimestamp(record.timestamp)}

          <StatusBadge record={record} />

          {amount.isRaw ? (
            /* Число знаков контракта неизвестно, поэтому показаны
               необработанные единицы. Без пометки пользователь прочитал
               бы их как обычную сумму и ошибся на порядки. */
            <Badge variant="outline">contract units</Badge>
          ) : null}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm font-medium tabular-nums">
          {isOutgoing ? '−' : '+'}
          {amount.text} {amount.unit}
        </span>

        {/* У зависшей отправки действия важнее ссылки: обозреватель
            покажет ровно то же ожидание, а исправить положение можно
            только заменой. У остальных записей всё наоборот. */}
        {canReplace ? (
          <span className="flex items-center gap-2">
            <RowAction
              label="Speed up"
              hint="Repeat the same operation with a higher fee"
              onClick={() => onReplace(record.hash, REPLACEMENT_KIND.SpeedUp)}
            />
            <RowAction
              label="Cancel"
              hint="Take the transaction nonce with a transfer to yourself"
              onClick={() => onReplace(record.hash, REPLACEMENT_KIND.Cancel)}
            />
          </span>
        ) : explorer === null ? null : (
          <a
            href={`${explorer}/tx/${record.hash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Explorer
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
})

/**
 * Действие в строке списка.
 *
 * ОБЫЧНАЯ КНОПКА, А НЕ ССЫЛКА: замена меняет состояние кошелька,
 * никуда не ведёт и должна отзываться на пробел так же, как на Enter.
 *
 * ПОЯСНЕНИЕ ДАЁТСЯ В `title`, потому что в строке фиксированной высоты
 * места под текст нет, а «ускорить» и «отменить» — не синонимы: первое
 * доводит перевод до конца, второе пытается его не допустить.
 */
function RowAction({
  label,
  hint,
  onClick,
}: {
  readonly label: string
  readonly hint: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      className="rounded text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {label}
    </button>
  )
}

/**
 * Пометка состояния перевода.
 *
 * ЧЕТЫРЕ СОСТОЯНИЯ РАЗЛИЧАЮТСЯ, ПОТОМУ ЧТО ОЗНАЧАЮТ РАЗНОЕ.
 * Прежде все собственные отправки помечались одинаково — «ждёт
 * подтверждения», — и оставались такими навсегда, потому что следить
 * за ними было некому. Пользователь не мог узнать, дошёл перевод или
 * нет, из самого кошелька.
 *
 * ОТКАТ ВЫДЕЛЕН ОТДЕЛЬНО И ОКРАШЕН КАК ОШИБКА. Транзакция попала
 * в блок, газ списан, а операция не выполнена: показать её наравне
 * с состоявшейся значит сообщить о переводе, которого не было.
 *
 * ПОДТВЕРЖДЁННЫЕ ЗАПИСИ ПОМЕТКИ НЕ ПОЛУЧАЮТ. Пометка на каждой строке
 * перестаёт читаться; выделяется то, что требует внимания.
 */
function StatusBadge({ record }: { readonly record: ITransferRecord }) {
  if (record.status === TRANSACTION_STATUS.Pending) {
    return (
      <Badge variant="warning">
        {record.source === TRANSFER_SOURCE.Local
          ? 'Sent, waiting for a block'
          : 'Waiting for a block'}
      </Badge>
    )
  }

  if (record.status === TRANSACTION_STATUS.Reverted) {
    return <Badge variant="danger">Reverted, gas spent</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Replaced) {
    return <Badge variant="outline">Replaced by another transaction</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Dropped) {
    return <Badge variant="outline">Dropped from the queue</Badge>
  }

  return null
}
