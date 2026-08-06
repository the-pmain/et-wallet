import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { cn } from '@/shared/lib/utils'

import { Button } from './button'

interface DialogProps {
  readonly isOpen: boolean
  readonly onClose: () => void

  /** Заголовок. Он же связывается с окном для программ чтения экрана. */
  readonly title: string

  /** Подзаголовок под названием. */
  readonly description?: string

  readonly children?: ReactNode

  /** Нижний ряд действий. Без него окно закрывается только крестиком и Escape. */
  readonly footer?: ReactNode

  readonly className?: string
}

/**
 * Модальное окно.
 *
 * НА НАТИВНОМ `<dialog>`, А НЕ НА СВОЁМ СЛОЕ. Элемент даёт бесплатно
 * то, что вручную пишется десятками строк и постоянно пишется неверно:
 * удержание фокуса внутри окна, закрытие по Escape, отключение
 * остального документа для программ чтения экрана и верхний слой
 * браузера, которому не нужен `z-index` и который не обрезается
 * ни одним `overflow: hidden` у предков.
 *
 * Собственная ловушка фокуса — классический источник дыр
 * в доступности: она ловит Tab, но не ловит переход по заголовкам,
 * виртуальный курсор и жесты чтения с экрана. `showModal` закрывает
 * все эти пути разом, потому что делает это на уровне браузера.
 *
 * ЗАКРЫТИЕ ПО ФОНУ — ПО ПОЛОЖЕНИЮ УКАЗАТЕЛЯ, А НЕ ПО ЦЕЛИ СОБЫТИЯ.
 * Проверка `event.target === dialog` кажется рабочей, но ломается
 * на нажатии, начатом внутри окна и отпущенном на фоне: выделяя текст
 * мышью, пользователь случайно закрывал бы окно.
 */
export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog === null) {
      return
    }

    if (isOpen && !dialog.open) {
      /* `showModal` в jsdom отсутствует и подставляется в подготовке
         тестовой среды. Проверка здесь на случай другой среды без него:
         окно должно открыться хотя бы немодально, а не уронить экран. */
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }
    }

    if (!isOpen && dialog.open) {
      dialog.close()
    }
  }, [isOpen])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      /* Событие `close` приходит и от Escape, и от `dialog.close()`.
         Состояние снаружи обязано узнать об этом: иначе окно, закрытое
         клавишей, осталось бы «открытым» в состоянии, и повторное
         нажатие кнопки не открыло бы ничего. */
      onClose={onClose}
      onClick={(event) => {
        const dialog = dialogRef.current

        if (dialog === null) {
          return
        }

        const box = dialog.getBoundingClientRect()
        const isInside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom

        /* Нажатие клавиатурой (Enter на кнопке) приходит с нулевыми
           координатами и попало бы в «снаружи». */
        const isPointer = event.clientX !== 0 || event.clientY !== 0

        if (isPointer && !isInside) {
          dialog.close()
        }
      }}
      className={cn(
        /* `m-auto` ОБЯЗАТЕЛЕН, И ЭТО НЕ УКРАШЕНИЕ. Браузер центрирует
           модальное окно сам, но делает это через `margin: auto` при
           `inset: 0`. Сброс Tailwind обнуляет отступы у всех элементов,
           и вместе с ними — это правило: окно прижималось в левый
           верхний угол экрана. Измерено, глазами в этой среде
           не проверяется. */
        'm-auto w-[calc(100vw-2rem)] max-w-md',

        /* Высокое содержимое прокручивается внутри окна, а не выходит
           за экран: у элемента в верхнем слое обрезки предком нет,
           и без ограничения нижняя часть окна оказалась бы недоступна. */
        'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',

        'rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-raised',
        'backdrop:bg-background/70 backdrop:backdrop-blur-sm',
        'open:animate-in open:duration-200 open:zoom-in-95 open:fade-in',
        className,
      )}
    >
      {/* Внутренняя обёртка обязательна: отступы на самом `<dialog>`
          вошли бы в его прямоугольник, и нажатие по отступу считалось
          бы нажатием по фону. */}
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-base leading-tight font-semibold text-balance">
              {title}
            </h2>

            {description === undefined ? null : (
              <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 shrink-0"
            aria-label="Close"
            onClick={() => {
              dialogRef.current?.close()
            }}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {children}

        {footer === undefined ? null : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        )}
      </div>
    </dialog>
  )
}
