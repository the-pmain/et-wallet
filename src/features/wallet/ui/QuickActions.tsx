import { ChartPie, Copy, Download, FileCode, Send } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { IAccount } from '@/core'
import { copyWithAutoClear } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, Button, toast } from '@/shared/ui'

interface QuickActionsProps {
  readonly account: IAccount | null
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
 *
 * БЕЗ СОБСТВЕННОЙ КАРТОЧКИ. Раньше действия жили в отдельной плите под
 * балансом, и экран состоял из трёх одинаковых прямоугольников, ни один
 * из которых не выглядел главным. Теперь ряд встраивается в карточку
 * баланса: сумма и то, что с ней можно сделать, — один объект.
 *
 * УБРАНЫ ДВА ДУБЛЯ. Прежде здесь стояли «Lock» и «Refresh», уже
 * присутствующие на экране: блокировка — в шапке, обновление — в углу
 * карточки баланса. Одно и то же действие в двух местах не добавляет
 * удобства, а размывает ряд главных: среди пяти равнозначных кнопок
 * отправка перестаёт быть заметной. Отсюда четыре плитки вместо пяти.
 */
export function QuickActions({ account }: QuickActionsProps) {
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
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch gap-1.5">
        <ActionTile
          to="/wallet/send"
          icon={Send}
          label={t('dashboard.send')}
          isPrimary
          isDisabled={account === null}
        />

        <ActionTile
          icon={Download}
          label={t('dashboard.receive')}
          isDisabled={account === null}
          onClick={() => {
            setAddressVisible((visible) => !visible)
          }}
        />

        {/* Портфель раньше стоял отдельной кнопкой под суммой. Здесь он
            равноправен с остальными: это такое же обращение к деньгам,
            а не примечание к балансу. */}
        <ActionTile to="/wallet/portfolio" icon={ChartPie} label={t('dashboard.portfolio')} />

        {/* Функциональности за кнопкой пока нет. Нажатие показывает
            честное уведомление, а не сообщение об отправке того, чего
            не отправляли: тост «отправлено на подпись» при пустом
            действии — та самая ложь интерфейса, против которой
            выстроен кошелёк. Занесено в TECH_DEBT. */}
        <ActionTile
          icon={FileCode}
          label={t('dashboard.smartContract')}
          onClick={() => {
            toast(t('dashboard.smartContractSoon'))
          }}
        />
      </div>

      {/* Оговорка о нативной валюте переехала в карточку баланса под
          этот ряд: там она стоит одна вместо двух абзацев об одном
          и том же, разрывавших сумму и действия. */}

      {isAddressVisible && account !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/70 p-3">
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
    </div>
  )
}

interface ActionTileProps {
  readonly icon: typeof Send
  readonly label: string

  /** Адрес перехода. Без него плитка отрисовывается кнопкой. */
  readonly to?: string
  readonly onClick?: () => void
  readonly isPrimary?: boolean
  readonly isDisabled?: boolean
}

/**
 * Плитка быстрого действия: значок в круге, подпись под ним.
 *
 * ЗНАЧОК В КРУГЕ, А НЕ САМ ПО СЕБЕ. Круг задаёт цель нажатия видимого
 * размера: у голого значка размером с букву цель приходится угадывать.
 *
 * ССЫЛКА ОСТАЁТСЯ ССЫЛКОЙ. Переход, оформленный кнопкой, теряет средний
 * щелчок, «открыть в новой вкладке» и объявление «ссылка» в программе
 * чтения с экрана. Поэтому разметка выбирается по назначению, а не по виду.
 *
 * ОТКЛЮЧЁННАЯ ПЛИТКА-ССЫЛКА СТАНОВИТСЯ ТЕКСТОМ. У ссылки нет состояния
 * «отключена»: атрибут `disabled` на `<a>` браузером не поддержан, и
 * переход всё равно сработал бы.
 */
function ActionTile({ icon: Icon, label, to, onClick, isPrimary, isDisabled }: ActionTileProps) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full transition-colors',
          isPrimary === true
            ? 'bg-primary text-primary-foreground'
            : 'bg-primary/12 text-primary-emphasis',
        )}
      >
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="w-full text-center leading-tight text-balance">{label}</span>
    </>
  )

  const shared = cn(
    'action-tile focus-ring',
    isDisabled === true ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:bg-accent',
  )

  if (to !== undefined) {
    return isDisabled === true ? (
      <span className={shared} aria-disabled>
        {content}
      </span>
    ) : (
      <Link to={to} className={shared}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" className={shared} onClick={onClick} disabled={isDisabled === true}>
      {content}
    </button>
  )
}
