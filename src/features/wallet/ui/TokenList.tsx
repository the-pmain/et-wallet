import { ChevronDown, RefreshCw, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'

import { safeText, type Address, type ChainId, type IPortfolioSummary } from '@/core'
import { UntrustedText } from '@/features/security'
import { cn } from '@/shared/lib/utils'
import { Button, Skeleton } from '@/shared/ui'

import { estimateValue, findQuote } from '../lib/asset-value'
import { formatTokenAmount, shortenAddress } from '../lib/format'
import { networkNameForChainId } from '../lib/network-name'
import { useDisplayCurrency } from '../model/display-currency-context'
import type { ITokenBalance } from '../model/contracts'
import { AmountWithUnit } from './AmountWithUnit'
import { TokenAvatar } from './TokenAvatar'
import { TokenDetails } from './TokenDetails'
import { TokenTrustBadge } from './TokenTrustBadge'

/** Сколько строк-заполнителей, пока список ещё пуст. */
export const TOKEN_LIST_SKELETON_COUNT = 3

interface TokenListProps {
  readonly tokens: readonly ITokenBalance[]
  readonly isLoading: boolean

  /**
   * Удаление добавленного контракта. Нет обработчика — нет кнопки:
   * витрина записи пользователя не правится с этого экрана.
   */
  readonly onRemove?: (address: Address) => void

  /**
   * Сводка портфеля. Отсюда берутся только курсы: оценка считается
   * от показанного количества.
   *
   * `null` — курсы неизвестны либо согласия на них нет. Тогда столбец
   * оценки не появляется вовсе; нулей вместо неизвестного не бывает.
   */
  readonly portfolio?: IPortfolioSummary | null
}

/**
 * Список токенов с балансами.
 *
 * НЕПРОЧИТАННЫЙ БАЛАНС НЕ ПОКАЗЫВАЕТСЯ НУЛЁМ. Контракт мог перестать
 * отвечать; ноль на его месте — утверждение «средств нет», которое
 * кошелёк в этот момент проверить не может.
 *
 * ДОБАВЛЕННЫЕ ВРУЧНУЮ ТОКЕНЫ ПОМЕЧЕНЫ. Обозначение сообщил контракт,
 * а выпустить токен с обозначением известного проекта может кто угодно.
 * Пометка не мешает пользоваться, но не даёт спутать подделку
 * с нативной валютой сети, чья конфигурация проверена.
 *
 * СТРОКА РАСКРЫВАЕТСЯ НА МЕСТЕ. Сведения живут в той же позиции списка,
 * а не во всплывающем меню: меню закрыло бы соседние балансы, а второе
 * `listitem` внутри строки сломало бы счётчик позиций. Удаление —
 * соседняя кнопка, не потомок раскрывающей: вложенные кнопки запрещены.
 */
export function TokenList({ tokens, isLoading, onRemove, portfolio = null }: TokenListProps) {
  /* `aria-busy` по той же причине, что и на карточке баланса: пока
     количество читается, на его месте вращается значок и больше
     ничего — зрячий это видит, слушающий страницу нет. */
  return (
    <ul className="divide-y divide-border" aria-busy={isLoading}>
      {isLoading && tokens.length === 0 ? <TokenListSkeleton /> : null}

      {tokens.map((entry) => (
        <TokenRow
          key={`${entry.token.chainId.toString()}:${entry.token.address ?? 'native'}`}
          entry={entry}
          isLoading={isLoading}
          portfolio={portfolio}
          {...(onRemove === undefined ? {} : { onRemove })}
        />
      ))}
    </ul>
  )
}

interface TokenRowProps {
  readonly entry: ITokenBalance
  readonly isLoading: boolean
  readonly portfolio: IPortfolioSummary | null
  readonly onRemove?: (address: Address) => void
}

function TokenRow({ entry, isLoading, portfolio, onRemove }: TokenRowProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const networkName = networkNameForChainId(entry.token.chainId)
  const symbol = safeText(entry.token.symbol)
  const canRemove = onRemove !== undefined && entry.token.address !== null

  return (
    <li className="flex flex-col">
      <div className="relative">
        <button
          type="button"
          className="focus-ring flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/60 sm:px-6"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${symbol} on ${networkName} — asset details`}
          onClick={() => {
            setExpanded((current) => !current)
          }}
        >
          <TokenAvatar
            address={entry.token.address}
            symbol={entry.token.symbol}
            chainId={entry.token.chainId}
          />

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Символ и имя задаёт автор контракта: они могут содержать
                невидимые символы и переопределение направления письма,
                делающие подделку визуально неотличимой от оригинала. */}
            <span className="flex items-center gap-1.5 truncate text-sm font-medium">
              <UntrustedText value={entry.token.symbol} />
              <TokenTrustBadge token={entry.token} />
            </span>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <UntrustedText value={entry.token.name} />
              {entry.token.address === null ? null : ` · ${shortenAddress(entry.token.address)}`}
            </span>
          </span>

          <span className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-col items-end gap-0.5">
              {/* Количество — то, ради чего список открывают, и потому
                  весит больше имени. Табличные цифры плюс выравнивание
                  по правому краю: разряды обязаны встать друг под друга.

                  `min-w-0` и перенос по символам — защита от предельного
                  числа: измерено, что баланс спам-токена растягивал
                  строку до 1738 пикселей при доступных 734. Обрезать
                  сумму нельзя, поэтому она переносится. */}
              <span className="min-w-0 text-right text-base font-semibold break-all tabular-nums">
                {entry.balance === null ? (
                  isLoading ? (
                    <RefreshCw className="size-4 animate-spin text-muted-foreground" aria-hidden />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )
                ) : (
                  <AmountWithUnit
                    amount={formatTokenAmount(entry.balance, entry.token.decimals)}
                    unit={entry.token.symbol}
                    className="font-semibold"
                  />
                )}
              </span>

              {/* ОЦЕНКА ПОД КОЛИЧЕСТВОМ, А НЕ ВМЕСТО НЕГО. Настоящая
                  величина — та, что в монетах: она точна, она
                  подписывается, она не зависит от чужого сервиса.
                  Долларовая производная и набрана мельче именно
                  поэтому.

                  Строки нет там, где курс неизвестен: у токена вне
                  реестра источника, при отсутствии согласия на курсы
                  и при неполученном балансе. Прочерк в этих случаях
                  добавил бы столбец пустых прочерков во всю длину
                  списка, ничего не сообщая; отсутствие строки читается
                  так же и не занимает места. Что именно выпало
                  из оценки и почему — перечислено на экране портфеля. */}
              <AssetValue
                balance={entry.balance}
                decimals={entry.token.decimals}
                chainId={entry.token.chainId}
                address={entry.token.address}
                portfolio={portfolio}
                isLoading={isLoading}
              />
            </span>

            {/* Распорка только когда удаление реально есть. Пустой
                квадрат справа от шеврона перехватывал нажатие и
                строка казалась мёртвой — на витрине справочника
                удаления нет вовсе. */}
            {canRemove ? <span className="size-8 shrink-0" aria-hidden /> : null}

            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </button>

        {canRemove ? (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-10 size-8 -translate-y-1/2 text-muted-foreground hover:text-destructive sm:right-12"
            aria-label={`Remove token ${symbol}`}
            onClick={() => {
              onRemove(entry.token.address as Address)
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <TokenDetails detailsId={detailsId} token={entry.token} portfolio={portfolio} />
      ) : null}
    </li>
  )
}

interface AssetValueProps {
  readonly balance: bigint | null
  readonly decimals: number
  readonly chainId: ChainId | null
  readonly address: Address | null
  readonly portfolio: IPortfolioSummary | null
  readonly isLoading: boolean
}

/** Оценка одной строки списка. Место под строку занято всегда. */
function AssetValue({
  balance,
  decimals,
  chainId,
  address,
  portfolio,
  isLoading,
}: AssetValueProps) {
  const { formatUsd } = useDisplayCurrency()
  const value = estimateValue(balance, decimals, findQuote(portfolio, chainId, address))

  return (
    <span className="flex h-3 min-h-3 items-center justify-end">
      {value === null && isLoading ? <Skeleton className="h-3 w-14" /> : null}
      {value === null ? null : (
        <span className="text-right text-xs break-words text-muted-foreground tabular-nums">
          ≈ {formatUsd(value)}
        </span>
      )}
    </span>
  )
}

function TokenListSkeleton() {
  return (
    <>
      {Array.from({ length: TOKEN_LIST_SKELETON_COUNT }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-6" aria-hidden>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-28" />
          </span>
          <span className="flex min-w-0 flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </span>
          <span className="size-8 shrink-0" />
        </li>
      ))}
    </>
  )
}
