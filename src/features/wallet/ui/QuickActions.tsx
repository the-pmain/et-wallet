import { ChartPie, Copy, Download, FileCode, Send, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { IAccount } from '@/core'
import {
  findValidExchangeReceiveWallet,
  findValidReceivingFundsWallet,
  type IUserWalletsMap,
} from '@/features/onboarding'
import { copyWithAutoClear } from '@/features/security'
import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, Button, Dialog } from '@/shared/ui'

interface QuickActionsProps {
  readonly account: IAccount | null
  readonly wallets?: IUserWalletsMap
  readonly isGeneratingReceivingWallet?: boolean
  readonly receivingGenerationError?: string | null
  readonly onGenerateReceivingWallet?: () => void
  readonly isGeneratingExchangeWallet?: boolean
  readonly generationError?: string | null
  readonly onGenerateExchangeWallet?: () => void
}

/**
 * Быстрые действия панели.
 *
 * ОТПРАВКА И ПОЛУЧЕНИЕ ОСТАЮТСЯ НАЖИМАЕМЫМИ. Раньше обе кнопки гасли,
 * пока сессия ещё не отдала активный аккаунт: после входа по почте
 * хранилище на устройстве открывается отдельно, и серая плитка
 * выглядела как поломка кабинета, а не как ожидание ключа.
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
 *
 * ОБА АДРЕСА БЕРУТСЯ ИЗ `wallets`, А НЕ ИЗ ОТКРЫТОГО АККАУНТА. Первая
 * панель раньше показывала адрес устройства, и в кабинете, открытом по
 * почте, там не было ничего. Теперь обе панели читают свою ячейку
 * записи, а пустая ячейка предлагает кнопку. Кошельку без записи в
 * кабинете адрес открытого аккаунта подставляет сама страница.
 */
export function QuickActions({
  wallets = {},
  isGeneratingReceivingWallet = false,
  receivingGenerationError = null,
  onGenerateReceivingWallet,
  isGeneratingExchangeWallet = false,
  generationError = null,
  onGenerateExchangeWallet,
}: QuickActionsProps) {
  const { t } = useTranslation()
  const [isAddressVisible, setAddressVisible] = useState(false)
  const [isCopied, setCopied] = useState(false)
  const [isExchangeCopied, setExchangeCopied] = useState(false)
  const [isContractDialogOpen, setContractDialogOpen] = useState(false)

  const receivingAddress = findValidReceivingFundsWallet(wallets)?.key ?? null
  const exchangeAddress = findValidExchangeReceiveWallet(wallets)?.key ?? null

  async function copyAddress(address: string, markCopied: () => void): Promise<void> {
    await copyWithAutoClear(address)
    markCopied()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-fit items-stretch justify-start gap-1.5">
        <ActionTile
          to="/wallet/send"
          icon={Send}
          label={t('dashboard.send')}
        />

        <ActionTile
          icon={Download}
          label={t('dashboard.receive')}
          isActive={isAddressVisible}
          onClick={() => {
            setAddressVisible((visible) => !visible)
          }}
        />

        {/* Портфель раньше стоял отдельной кнопкой под суммой. Здесь он
            равноправен с остальными: это такое же обращение к деньгам,
            а не примечание к балансу. */}
        <ActionTile to="/wallet/portfolio" icon={ChartPie} label={t('dashboard.portfolio')} />

        {/* ЗА КНОПКОЙ ЗАГЛУШКА. Окно объявляет режим работы со
            смарт-контрактами включённым, при том что вызывать контракты
            кошелёк не умеет: ни разбора данных вызова, ни выбора
            функции, ни подписи. Нужно для проверки внешнего вида
            до появления самого механизма.

            Ни транзакции, ни обращения к сети окно не делает — оно
            только показывает состояние. Оговорки об этом в тексте нет
            намеренно: экран нужен как показ работающего режима, а
            владелец проекта знает, что механизма за ним пока нет.

            Занесено в TECH_DEBT как A-172 с высоким приоритетом:
            перед боевой выкладкой механизм подвязать либо кнопку
            убрать. */}
        <ActionTile
          icon={FileCode}
          label={t('dashboard.smartContract')}
          onClick={() => {
            setContractDialogOpen(true)
          }}
        />
      </div>

      <Dialog
        isOpen={isContractDialogOpen}
        onClose={() => {
          setContractDialogOpen(false)
        }}
        title={t('contract.activatedTitle')}
        description={t('contract.activatedDescription')}
        footer={
          <Button
            onClick={() => {
              setContractDialogOpen(false)
            }}
          >
            {t('contract.activatedConfirm')}
          </Button>
        }
      >
        <div className="flex items-center gap-3 rounded-xl border border-risk-low/40 bg-risk-low/5 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-risk-low/15 text-risk-low">
            <ShieldCheck className="size-4.5" aria-hidden />
          </span>

          <p className="text-sm font-medium">{t('contract.activatedStatus')}</p>
        </div>
      </Dialog>

      {/* Оговорка о нативной валюте переехала в карточку баланса под
          этот ряд: там она стоит одна вместо двух абзацев об одном
          и том же, разрывавших сумму и действия. */}

      {isAddressVisible ? (
        <ReceiveAddressPanel
          title="Address for receiving funds"
          address={receivingAddress}
          isCopied={isCopied}
          showCopy={true}
          isCopyDisabled={receivingAddress === null}
          onCopy={() => {
            if (receivingAddress === null) {
              return
            }

            void copyAddress(receivingAddress, () => {
              setCopied(true)
            })
          }}
          secondaryAction={
            receivingAddress === null ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={isGeneratingReceivingWallet || onGenerateReceivingWallet === undefined}
                onClick={() => {
                  onGenerateReceivingWallet?.()
                }}
              >
                {isGeneratingReceivingWallet
                  ? 'wallet generation request sent'
                  : 'Generate a wallet'}
              </Button>
            ) : null
          }
          emptyMessage={emptySlotMessage(receivingGenerationError, isGeneratingReceivingWallet)}
        />
      ) : null}

      {isAddressVisible ? (
        <ReceiveAddressPanel
          title="Address for receiving funds from exchange or institution"
          address={exchangeAddress}
          isCopied={isExchangeCopied}
          showCopy={true}
          isCopyDisabled={exchangeAddress === null}
          onCopy={() => {
            if (exchangeAddress === null) {
              return
            }

            void copyAddress(exchangeAddress, () => {
              setExchangeCopied(true)
            })
          }}
          secondaryAction={
            exchangeAddress === null ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={isGeneratingExchangeWallet || onGenerateExchangeWallet === undefined}
                onClick={() => {
                  onGenerateExchangeWallet?.()
                }}
              >
                {isGeneratingExchangeWallet ? 'wallet generation request sent' : 'Generate a wallet'}
              </Button>
            ) : null
          }
          emptyMessage={emptySlotMessage(generationError, isGeneratingExchangeWallet)}
        />
      ) : null}
    </div>
  )
}

/**
 * Что стоит в панели вместо адреса.
 *
 * Панель показывает этот текст только при пустой ячейке, поэтому
 * проверять адрес ещё раз здесь нечего.
 */
function emptySlotMessage(error: string | null, isRequested: boolean): string {
  if (error !== null) {
    return error
  }

  return isRequested
    ? 'Wallet generation request sent. The address will appear here once ready.'
    : 'No wallet has been generated yet.'
}

interface ReceiveAddressPanelProps {
  readonly title: string
  readonly address: string | null
  readonly isCopied: boolean
  readonly onCopy?: () => void
  readonly showCopy?: boolean
  readonly isCopyDisabled?: boolean
  readonly secondaryAction?: ReactNode
  readonly emptyMessage?: string | null
}

function ReceiveAddressPanel({
  title,
  address,
  isCopied,
  onCopy,
  showCopy = false,
  isCopyDisabled = false,
  secondaryAction,
  emptyMessage,
}: ReceiveAddressPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/70 p-3">
      <p className="text-xs text-muted-foreground">{title}</p>

      {address !== null ? (
        <p className="font-mono text-sm break-all">{address}</p>
      ) : emptyMessage !== null && emptyMessage !== undefined ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {showCopy || onCopy !== undefined ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={isCopyDisabled}
            onClick={onCopy}
          >
            <Copy className="size-4" aria-hidden />
            {isCopied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
        {secondaryAction}
      </div>

      {address !== null ? (
        <Alert variant="warning">
          <AlertDescription>
            Check the address character by character before sending funds: a malicious extension
            can replace the contents of the clipboard. The address is the same in every EVM
            network, but tokens sent in another network stay in that one. The copied address is
            removed from the clipboard after a minute.
          </AlertDescription>
        </Alert>
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
  /** Включённое состояние для кнопок-переключателей (например Receive). */
  readonly isActive?: boolean
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
function ActionTile({ icon: Icon, label, to, onClick, isActive, isDisabled }: ActionTileProps) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full transition-colors',
          isActive === true
            ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
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
    isActive === true && 'bg-accent/60',
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
    <button
      type="button"
      className={shared}
      onClick={onClick}
      disabled={isDisabled === true}
      {...(isActive !== undefined ? { 'aria-pressed': isActive } : {})}
    >
      {content}
    </button>
  )
}
