import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '@/shared/lib/utils'

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'>

/**
 * Флажок подтверждения.
 *
 * Реализован нативным `input[type=checkbox]`, скрытым визуально, но
 * доступным программам чтения с экрана и клавиатуре. Собственная
 * реализация на `div` с ролью потребовала бы вручную воспроизводить
 * поведение, которое браузер уже даёт бесплатно, — и неизбежно
 * воспроизвела бы его хуже.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          'peer size-4 shrink-0 appearance-none rounded-[4px] border shadow-xs transition-shadow outline-none',
          'checked:border-primary checked:bg-primary',
          'focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  )
}
