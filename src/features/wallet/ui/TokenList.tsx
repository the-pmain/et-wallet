import { safeText } from '@/core'
import { RefreshCw, Trash2 } from 'lucide-react'

import type { Address, ChainId, IPortfolioSummary } from '@/core'
import { UntrustedText } from '@/features/security'
import { Button } from '@/shared/ui'

import { estimateValue, findQuote } from '../lib/asset-value'
import { formatTokenAmount, shortenAddress } from '../lib/format'
import { formatFiat } from '../lib/portfolio-display'
import type { ITokenBalance } from '../model/contracts'
import { TokenAvatar } from './TokenAvatar'
import { TokenTrustBadge } from './TokenTrustBadge'

interface TokenListProps {
  readonly tokens: readonly ITokenBalance[]
  readonly isLoading: boolean
  readonly onRemove: (address: Address) => void

  /**
   * Сеть, в которой действуют контракты списка.
   *
   * Нужна знаку монеты: он выдаётся по паре «сеть и адрес», сверенной
   * со встроенным реестром, а один и тот же адрес в разных сетях —
   * разные контракты.
   */
  readonly chainId: ChainId | null

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
 */
export function TokenList({
  tokens,
  isLoading,
  onRemove,
  chainId,
  portfolio = null,
}: TokenListProps) {
  /* `aria-busy` по той же причине, что и на карточке баланса: пока
     количество читается, на его месте вращается значок и больше
     ничего — зрячий это видит, слушающий страницу нет. */
  return (
    <ul className="divide-y divide-border" aria-busy={isLoading}>
      {tokens.map((entry) => (
        <li
          key={entry.token.address ?? 'native'}
          className="flex items-center gap-3 px-4 py-3.5 sm:px-6"
        >
          <TokenAvatar
            address={entry.token.address}
            symbol={entry.token.symbol}
            chainId={chainId}
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

          {/* Группа сжимается, а кнопка внутри — нет. `shrink-0` здесь
                не давал сжаться всей колонке, и ограничитель на самом
                числе не действовал: ширину диктовало содержимое. */}
          <span className="flex min-w-0 items-center gap-1">
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
                  formatTokenAmount(entry.balance, entry.token.decimals)
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
                chainId={chainId}
                address={entry.token.address}
                portfolio={portfolio}
              />
            </span>

            {/* МЕСТО ПОД КНОПКУ ЗАНЯТО ДАЖЕ ТАМ, ГДЕ КНОПКИ НЕТ.
                У нативной валюты удаления быть не может, и без распорки
                её количество съезжало вправо на ширину кнопки — числа
                соседних строк переставали стоять в столбец. Ради этого
                столбца и существуют табличные цифры, и распорка
                шириной в кнопку — самый дешёвый способ его сохранить. */}
            <span className="flex size-8 shrink-0 items-center justify-center">
              {entry.token.address === null ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  /* Видимый размер меньше обычного намеренно:
                     разрушающее действие не должно спорить за внимание
                     с количеством. Область нажатия при этом остаётся
                     полной — её задаёт `tap-target` в базовом наборе
                     классов кнопки. */
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove token ${safeText(entry.token.symbol)}`}
                  onClick={() => {
                    onRemove(entry.token.address as Address)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

interface AssetValueProps {
  readonly balance: bigint | null
  readonly decimals: number
  readonly chainId: ChainId | null
  readonly address: Address | null
  readonly portfolio: IPortfolioSummary | null
}

/** Оценка одной строки списка. Ничего не рисует, когда курс неизвестен. */
function AssetValue({ balance, decimals, chainId, address, portfolio }: AssetValueProps) {
  const value = estimateValue(balance, decimals, findQuote(portfolio, chainId, address))

  if (value === null) {
    return null
  }

  return (
    <span className="text-right text-xs break-words text-muted-foreground tabular-nums">
      ≈ {formatFiat(value)}
    </span>
  )
}
