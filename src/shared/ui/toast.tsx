import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'

import { cn } from '@/shared/lib/utils'

import {
  TOAST_DURATION_MS,
  dismissToast,
  getToasts,
  subscribeToasts,
  type IToast,
  type ToastTone,
} from './toast-store'

const TONE_STYLES: Record<ToastTone, string> = {
  neutral: 'border-border bg-card text-card-foreground',
  success: 'border-risk-low/40 bg-card text-card-foreground [&_svg]:text-risk-low',
  warning: 'border-risk-medium/40 bg-card text-card-foreground [&_svg]:text-risk-medium',
  danger: 'border-destructive/40 bg-card text-card-foreground [&_svg]:text-destructive',
}

const TONE_ICON: Record<ToastTone, typeof Info> = {
  neutral: Info,
  success: CircleCheck,
  warning: CircleAlert,
  danger: CircleAlert,
}

/**
 * Область показа уведомлений.
 *
 * МОНТИРУЕТСЯ ОДИН РАЗ В ОБОЛОЧКЕ. Несколько областей показывали бы одно
 * уведомление дважды: хранилище общее.
 *
 * СТОИТ ПОД ФИКСИРОВАННЫМ УГЛОМ, НАД ВСЕМ. Уведомление сообщает об уже
 * случившемся и не должно перехватывать нажатия по тому, что под ним, —
 * поэтому слой прозрачен для указателя, а сами карточки нет.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-end gap-2 p-4 pt-[calc(env(safe-area-inset-top)+1rem)]"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => (
        <ToastCard key={item.id} toast={item} />
      ))}
    </div>
  )
}

function ToastCard({ toast: item }: { readonly toast: IToast }) {
  const Icon = TONE_ICON[item.tone]

  /* Само уведомление снимает себя по времени. Таймер живёт в эффекте,
     а не в общем хранилище: так он привязан к жизни карточки и не
     переживёт её удаление пользователем. */
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      dismissToast(item.id)
    }, TOAST_DURATION_MS)

    return () => {
      globalThis.clearTimeout(timer)
    }
  }, [item.id])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border p-3 text-sm shadow-lg backdrop-blur-md',
        'animate-in duration-200 fade-in slide-in-from-top-2 motion-reduce:animate-none',
        TONE_STYLES[item.tone],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1">{item.message}</span>

      <button
        type="button"
        aria-label="Dismiss"
        className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => {
          dismissToast(item.id)
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
