import { useTranslation } from '@/shared/i18n'
import { cn } from '@/shared/lib/utils'

import { DISPLAY_CURRENCIES, type DisplayCurrency } from '../lib/display-currency'

interface CurrencySwitchProps {
  readonly value: DisplayCurrency
  readonly onChange: (currency: DisplayCurrency) => void
}

/**
 * Выбор валюты показа.
 *
 * Стоит слева в шапке карточки баланса: это первое, чем задают,
 * в каких единицах читать сумму. Переключение не меняет сами деньги,
 * только подпись.
 */
export function CurrencySwitch({ value, onChange }: CurrencySwitchProps) {
  const { t } = useTranslation()

  return (
    <div
      role="radiogroup"
      aria-label={t('dashboard.displayCurrency')}
      className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5"
    >
      {DISPLAY_CURRENCIES.map((currency) => {
        const isSelected = currency === value

        return (
          <button
            key={currency}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => {
              onChange(currency)
            }}
            className={cn(
              'focus-ring min-h-8 min-w-11 cursor-pointer rounded-md px-2 text-xs font-semibold tracking-wide',
              isSelected
                ? 'bg-primary/15 text-primary-emphasis shadow-surface'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {currency}
          </button>
        )
      })}
    </div>
  )
}
