import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  /** Сообщение отказа. `null`, пока сбоя не было. */
  readonly reason: string | null
}

/**
 * Перехват сбоев отрисовки.
 *
 * ЗАЧЕМ ЭТО КОШЕЛЬКУ. Необработанная ошибка в React размонтирует всё
 * дерево: пользователь видит белый экран. Для владельца средств пустой
 * экран неотличим от пропажи денег — а в действительности не произошло
 * ничего: ключи зашифрованы на диске, seed-фраза цела, транзакции
 * в блокчейне не зависят от того, что нарисовал браузер.
 *
 * ПОЭТОМУ ЭКРАН ОТКАЗА ГОВОРИТ ИМЕННО ЭТО. Сообщение «что-то пошло
 * не так» здесь бесполезно: оно не отвечает на единственный вопрос,
 * который возникает у человека, — целы ли средства.
 *
 * ПРИЧИНА ПОКАЗЫВАЕТСЯ ДОСЛОВНО. Без неё владелец не сможет ни понять,
 * повторяется ли сбой, ни рассказать о нём. Текст ошибки не содержит
 * секретов: ключи и фраза в сообщения не попадают, а если бы попадали —
 * это была бы отдельная, куда более серьёзная неисправность.
 *
 * КЛАССОВЫЙ КОМПОНЕНТ — ЕДИНСТВЕННЫЙ СПОСОБ. Перехват ошибок отрисовки
 * доступен только через `componentDidCatch`; хука с такой возможностью
 * в React нет.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { reason: null }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { reason: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* Единственное место в приложении, где вывод в консоль оправдан:
       иначе сведения о сбое исчезают вместе с деревом компонентов. */
    console.error('Сбой отрисовки', error, info.componentStack)
  }

  override render(): ReactNode {
    const { reason } = this.state

    if (reason === null) {
      return this.props.children
    }

    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold">Приложение остановилось</h1>

        <p className="text-sm">
          Средства на месте. Сбой произошёл в интерфейсе кошелька и не затрагивает ни ключи, ни
          seed-фразу, ни то, что уже записано в блокчейне: они хранятся отдельно от того, что
          рисуется на экране.
        </p>

        <p className="text-sm">
          Перезагрузите страницу. Если сбой повторяется, состояние адреса всегда можно проверить в
          обозревателе блоков — кошелёк для этого не нужен.
        </p>

        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">Что сообщил браузер</span>
          <span className="font-mono text-xs break-all">{reason}</span>
        </div>

        <button
          type="button"
          className="h-10 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
          onClick={() => {
            globalThis.location.reload()
          }}
        >
          Перезагрузить
        </button>

        <p className="text-xs text-muted-foreground">
          Seed-фраза при перезагрузке не потребуется: кошелёк откроется тем же паролем.
        </p>
      </div>
    )
  }
}
