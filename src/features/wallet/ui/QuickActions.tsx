import { Copy, Download, FileCode, Lock, RefreshCw, Send } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { IAccount } from '@/core'
import { copyWithAutoClear } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { Alert, AlertDescription, Button, Card, CardContent, toast } from '@/shared/ui'

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

          {/* Функциональности за кнопкой пока нет. Нажатие показывает
              честное уведомление, а не сообщение об отправке того, чего
              не отправляли: тост «отправлено на подпись» при пустом
              действии — та самая ложь интерфейса, против которой
              выстроен кошелёк. Занесено в TECH_DEBT. */}
          <Button
            variant="outline"
            onClick={() => {
              toast(t('dashboard.smartContractSoon'))
            }}
          >
            <FileCode className="size-4" aria-hidden />
            {t('dashboard.smartContract')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          The native currency of the network is sent here. Token transfers live on their own screen:
          there the recipient is written into the call data, not into the recipient field.
        </p>

        {isAddressVisible && account !== null ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Address for receiving funds</p>
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
                {isCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <Alert variant="warning">
              <AlertDescription>
                Check the address character by character before sending funds: a malicious extension
                can replace the contents of the clipboard. The address is the same in every EVM
                network, but tokens sent in another network stay in that one. The copied address is
                removed from the clipboard after a minute.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
