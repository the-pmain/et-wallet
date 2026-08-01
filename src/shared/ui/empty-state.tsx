import type { ComponentType, ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

export interface EmptyStateProps {
  readonly icon: ComponentType<{ className?: string }>
  readonly title: string

  /**
   * Объяснение, почему список пуст.
   *
   * Обязательное поле, а не необязательное. Пустой список без объяснения
   * пользователь читает как «у меня ничего нет» — и это опасное прочтение,
   * когда настоящая причина в том, что кошелёк ещё не умеет читать эти
   * данные. Разница между «активов нет» и «активы не отслеживаются»
   * определяет, побежит ли человек искать пропавшие средства.
   */
  readonly description: ReactNode

  readonly action?: ReactNode
  readonly className?: string
}

/**
 * Пустое состояние списка с обязательным объяснением причины.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <div className="icon-tile size-12 rounded-2xl">
        <Icon className="size-6" />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {action}
    </div>
  )
}
