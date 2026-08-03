import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

import type { IBalance, INetworkConfig } from '@/core'
import { useTranslation } from '@/shared/i18n'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'

import { formatTokenAmount } from '../lib/format'

interface BalanceCardProps {
  readonly balance: IBalance | null
  readonly network: INetworkConfig | null
  readonly isLoading: boolean
  readonly error: string | null
  readonly onRefresh: () => void

  /**
   * Переход, добавляемый под балансом.
   *
   * Передаётся страницей, а не собирается здесь: адреса экранов живут
   * в слое приложения, а этот слой их не видит. Ссылка, собранная тут
   * строковым литералом, разошлась бы с таблицей маршрутов при первом
   * же переименовании.
   */
  readonly action?: ReactNode
}

/**
 * Баланс нативной валюты активного аккаунта.
 *
 * ЧЕТЫРЕ СОСТОЯНИЯ РАЗЛИЧАЮТСЯ ЯВНО: значение получено, значение устарело,
 * значение получить не удалось, значение ещё не получено. Свести их к одному
 * «0» — самая опасная экономия в кошельке: пользователь, увидевший ноль
 * вместо недоступного баланса, решит, что средства пропали.
 *
 * ТОКЕНЫ НЕ ПОКАЗЫВАЮТСЯ, И ОБ ЭТОМ СКАЗАНО. Пустой список токенов
 * читался бы как «токенов нет».
 */
export function BalanceCard({
  balance,
  network,
  isLoading,
  error,
  onRefresh,
  action,
}: BalanceCardProps) {
  const { t } = useTranslation()
  const symbol = network?.nativeCurrency.symbol ?? ''

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base font-medium text-muted-foreground">
          {t('dashboard.balance')}
          {network === null ? '' : ` · ${network.name}`}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh the balance"
        >
          <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        {balance === null ? (
          <p className="text-3xl font-semibold text-muted-foreground tabular-nums">
            {isLoading ? 'Loading…' : '—'}
          </p>
        ) : (
          <p className="text-3xl font-semibold tabular-nums">
            {formatTokenAmount(balance.raw, balance.decimals)}{' '}
            <span className="text-xl text-muted-foreground">{symbol}</span>
          </p>
        )}

        {balance !== null && balance.isStale && error === null ? (
          <p className="text-xs text-muted-foreground">
            A cached value, refresh in progress. Do not decide to send based on a stale amount.
          </p>
        ) : null}

        {error !== null ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              The node did not answer. The value shown may be stale — that does not mean the funds
              are gone.
            </span>
          </p>
        ) : null}

        {/* Отслеживаемые токены появились на этапе токенов, и прежняя
            оговорка «балансы ERC-20 не отслеживаются» стала неверной.
            Оставить её значило бы предупреждать о несуществующем
            ограничении, а такие предупреждения приучают не читать
            остальные. */}
        <p className="text-xs text-muted-foreground">{t('dashboard.nativeOnly')}</p>

        {action}
      </CardContent>
    </Card>
  )
}
