import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react'
import { memo } from 'react'

import {
  TRANSACTION_STATUS,
  TRANSFER_DIRECTION,
  TRANSFER_SOURCE,
  type INetworkConfig,
  type ITransferRecord,
} from '@/core'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui'

import { formatTimestamp, shortenAddress } from '../lib/format'
import { describeAmount, describeKind } from '../lib/transfer-display'

interface TransferRowProps {
  readonly record: ITransferRecord
  readonly network: INetworkConfig | null
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
export const TransferRow = memo(function TransferRow({ record, network }: TransferRowProps) {
  const isOutgoing = record.direction === TRANSFER_DIRECTION.Outgoing
  const amount = describeAmount(record, network)
  const counterparty = isOutgoing ? record.to : record.from
  const explorer = network?.blockExplorerUrls[0] ?? null

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
            ? `Блок ${record.blockNumber.toString()}`
            : formatTimestamp(record.timestamp)}

          <StatusBadge record={record} />

          {amount.isRaw ? (
            /* Число знаков контракта неизвестно, поэтому показаны
               необработанные единицы. Без пометки пользователь прочитал
               бы их как обычную сумму и ошибся на порядки. */
            <Badge variant="outline">единицы контракта</Badge>
          ) : null}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm font-medium tabular-nums">
          {isOutgoing ? '−' : '+'}
          {amount.text} {amount.unit}
        </span>

        {explorer === null ? null : (
          <a
            href={`${explorer}/tx/${record.hash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Обозреватель
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
})

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
        {record.source === TRANSFER_SOURCE.Local ? 'Отправлено, ждёт блока' : 'Ждёт блока'}
      </Badge>
    )
  }

  if (record.status === TRANSACTION_STATUS.Reverted) {
    return <Badge variant="danger">Откачено, газ списан</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Replaced) {
    return <Badge variant="outline">Замещено другой транзакцией</Badge>
  }

  if (record.status === TRANSACTION_STATUS.Dropped) {
    return <Badge variant="outline">Вытеснено из очереди</Badge>
  }

  return null
}
