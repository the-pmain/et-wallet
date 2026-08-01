import { Info, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  EMPTY_TRANSFER_FILTER,
  TRANSFER_CATEGORY,
  TransferFilterBar,
  TransferList,
  filterTransfers,
  isFilterActive,
  useWallet,
  useWalletSnapshot,
  type ITransferFilter,
} from '@/features/wallet'
import { Alert, AlertDescription, Button, Card, CardContent } from '@/shared/ui'

/**
 * История переводов активного аккаунта.
 *
 * ОГРАНИЧЕНИЯ ИСТОЧНИКА ПОКАЗЫВАЮТСЯ ЯВНО И НЕ ЗАВИСЯТ ОТ ОТБОРА.
 * Разбор журналов узла не видит переводов нативной валюты — они не
 * порождают событий — и охватывает лишь недавнее окно блоков. Показать
 * такую выборку без оговорки значит утверждать, что других операций
 * не было; для владельца средств это равнозначно сообщению о пропаже.
 *
 * ОТБОР ПРИМЕНЯЕТСЯ К УЖЕ ПОЛУЧЕННЫМ ЗАПИСЯМ. Он ничего не запрашивает
 * заново и не может расширить выдачу источника. Поэтому пустой результат
 * отбора и пустая история описываются разными словами: первое означает
 * «под условия ничего не подошло», второе — «источник ничего не вернул».
 */
export function ActivityPage() {
  const session = useWallet()
  const snapshot = useWalletSnapshot()

  /* Условия отбора живут в состоянии экрана, а не в адресной строке:
     запрос содержит адрес контрагента, а адресная строка сохраняется
     в истории браузера и доступна расширениям. */
  const [filter, setFilter] = useState<ITransferFilter>(EMPTY_TRANSFER_FILTER)

  const network = snapshot.activeNetwork
  const limits = snapshot.historyLimits
  const nativeSymbol = network?.nativeCurrency.symbol ?? null

  const transfers = snapshot.transfers
  const visible = useMemo(() => filterTransfers(transfers, filter), [transfers, filter])

  const hasFilter = isFilterActive(filter)

  /* Отбор по нативной валюте при источнике, который её не видит, даёт
     пустой список. Без объяснения он читается как «переводов не было» —
     утверждение, которого кошелёк в этом случае делать не вправе. */
  const isNativeBlindSpot =
    filter.category === TRANSFER_CATEGORY.Native && limits?.nativeTransfersUnavailable === true

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">История</h1>

        <Button
          variant="ghost"
          size="sm"
          disabled={snapshot.isHistoryLoading}
          onClick={() => void session.refreshHistory()}
        >
          <RefreshCw
            className={snapshot.isHistoryLoading ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden
          />
          Обновить
        </Button>
      </header>

      {limits?.sourceUnavailable === true ? (
        <Alert variant="danger">
          <AlertDescription>
            Историю получить не удалось, поэтому показаны только отправки, сделанные из этого
            кошелька. Это не означает, что других операций не было.
            {limits.reason === null ? null : <> Узел ответил: «{limits.reason}».</>} Многие
            публичные узлы отказывают в поиске по всем контрактам сразу. Подключите собственный узел
            в настройках либо укажите ключ индексатора.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits?.nativeTransfersUnavailable === true ? (
        <Alert variant="warning">
          <AlertDescription>
            Переводы {nativeSymbol ?? 'нативной валюты'} здесь не показаны. Кошелёк читает историю
            из журналов узла, а такие переводы событий не порождают и в журналах отсутствуют. Полная
            история требует индексатора — он получит ваш адрес и всю историю операций по нему.
          </AlertDescription>
        </Alert>
      ) : null}

      {limits?.scannedBlocks === null || limits === null ? null : (
        <Alert>
          <Info />
          <AlertDescription>
            Просмотрены последние {limits.scannedBlocks.toLocaleString('ru-RU')} блоков. Более
            ранние операции узел по одному запросу не отдаёт.
          </AlertDescription>
        </Alert>
      )}

      <TransferFilterBar filter={filter} onChange={setFilter} nativeSymbol={nativeSymbol} />

      {hasFilter && transfers.length > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          Показано {visible.length} из {transfers.length}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0 sm:p-0">
          <TransferList
            transfers={visible}
            network={network}
            isLoading={snapshot.isHistoryLoading}
            emptyTitle={hasFilter ? 'Под условия ничего не подошло' : 'Операций пока нет'}
            emptyDescription={
              hasFilter ? (
                <>
                  Отбор применяется к уже полученным записям и не запрашивает историю заново.
                  {isNativeBlindSpot ? (
                    <>
                      {' '}
                      Переводы {nativeSymbol ?? 'нативной валюты'} этому источнику недоступны в
                      принципе, поэтому пустой список здесь ничего не говорит о том, были такие
                      операции или нет.
                    </>
                  ) : null}{' '}
                  Снимите условия, чтобы увидеть всё, что удалось получить.
                </>
              ) : (
                <>
                  За доступный период операций не найдено. Кошелёк показывает переводы нативной
                  валюты, токенов ERC-20 и коллекционных токенов — в объёме, который отдаёт
                  подключённый источник.
                </>
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
