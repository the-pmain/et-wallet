import { Copy, Download, FileCode, Lock, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { IAccount } from '@/core'
import { copyWithAutoClear } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { Alert, AlertDescription, Button, Card, CardContent } from '@/shared/ui'

interface QuickActionsProps {
  readonly account: IAccount | null
  readonly onRefresh: () => void
  readonly onLock: () => void
  readonly isBusy: boolean
}

/**
 * Быстрые действия панели.
 *
 * ОТПРАВКА ОТКЛЮЧЕНА, А НЕ СПРЯТАНА. Кнопка, которой нет, оставляет
 * пользователя в догадках; кнопка, которая ничего не делает, выглядит
 * как поломка. Отключённая кнопка с указанием причины — единственный
 * честный из трёх вариантов.
 *
 * ПОЛУЧЕНИЕ ПОКАЗЫВАЕТ ПОЛНЫЙ АДРЕС, А НЕ УСЕЧЁННЫЙ. Усечённый адрес
 * нельзя проверить посимвольно, а именно посимвольная сверка защищает
 * от подмены буфера обмена вредоносным расширением.
 */
export function QuickActions({ account, onRefresh, onLock, isBusy }: QuickActionsProps) {
  const { t } = useTranslation()
  const [isAddressVisible, setAddressVisible] = useState(false)
  const [isCopied, setCopied] = useState(false)

  async function copyAddress(): Promise<void> {
    if (account === null) {
      return
    }

    /* Буфер обмена — общая для системы область, доступная любому
       приложению. Скопированный адрес живёт там до следующего
       копирования; автоматическая очистка сокращает это окно. */
    await copyWithAutoClear(account.address)
    setCopied(true)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button asChild variant="default" disabled={account === null}>
            <Link to="/wallet/send">
              <Send className="size-4" aria-hidden />
              {t('dashboard.send')}
            </Link>
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setAddressVisible((visible) => !visible)
            }}
            disabled={account === null}
          >
            <Download className="size-4" aria-hidden />
            {t('dashboard.receive')}
          </Button>

          <Button variant="outline" onClick={onRefresh} disabled={isBusy}>
            <RefreshCw className="size-4" aria-hidden />
            {t('dashboard.refresh')}
          </Button>

          <Button variant="outline" onClick={onLock}>
            <Lock className="size-4" aria-hidden />
            {t('dashboard.lock')}
          </Button>

          {/* Кнопка без действия — сознательное решение заказчика,
              а не упущение. Функциональности за ней пока нет; занесено
              в TECH_DEBT, чтобы состояние было видно, а не забыто. */}
          <Button variant="outline">
            <FileCode className="size-4" aria-hidden />
            {t('dashboard.smartContract')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Отправляется нативная валюта сети. Перевод токенов появится отдельным экраном: там
          получатель указывается в данных вызова, а не в поле получателя транзакции.
        </p>

        {isAddressVisible && account !== null ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Адрес для получения средств</p>
            <p className="font-mono text-sm break-all">{account.address}</p>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void copyAddress()
                }}
              >
                <Copy className="size-4" aria-hidden />
                {isCopied ? 'Скопировано' : 'Копировать'}
              </Button>
            </div>

            <Alert variant="warning">
              <AlertDescription>
                Сверьте адрес посимвольно перед отправкой средств: вредоносное расширение способно
                подменить содержимое буфера обмена. Адрес одинаков во всех сетях EVM, но токены,
                отправленные в другой сети, окажутся именно в ней. Скопированный адрес будет удалён
                из буфера обмена через минуту.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
