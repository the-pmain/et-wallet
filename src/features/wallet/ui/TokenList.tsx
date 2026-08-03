import { safeText } from '@/core'
import { RefreshCw, Trash2 } from 'lucide-react'

import type { Address } from '@/core'
import { UntrustedText } from '@/features/security'
import { Button } from '@/shared/ui'

import { formatTokenAmount, shortenAddress } from '../lib/format'
import type { ITokenBalance } from '../model/contracts'
import { TokenAvatar } from './TokenAvatar'
import { TokenTrustBadge } from './TokenTrustBadge'

interface TokenListProps {
  readonly tokens: readonly ITokenBalance[]
  readonly isLoading: boolean
  readonly onRemove: (address: Address) => void
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
export function TokenList({ tokens, isLoading, onRemove }: TokenListProps) {
  return (
    <ul className="divide-y divide-border">
      {tokens.map((entry) => (
        <li
          key={entry.token.address ?? 'native'}
          className="flex items-center gap-3 px-4 py-3 sm:px-6"
        >
          <TokenAvatar address={entry.token.address} symbol={entry.token.symbol} />

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

          <span className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-medium tabular-nums">
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

            {entry.token.address === null ? null : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove token ${safeText(entry.token.symbol)}`}
                onClick={() => {
                  onRemove(entry.token.address as Address)
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
