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
    console.error('Rendering failure', error, info.componentStack)
  }

  override render(): ReactNode {
    const { reason } = this.state

    if (reason === null) {
      return this.props.children
    }

    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-lg font-semibold">The application stopped</h1>

        <p className="text-sm">
          Your funds are safe. The failure happened in the wallet interface and touches neither the
          keys, nor the seed phrase, nor anything already written to the blockchain: they are stored
          separately from what is drawn on the screen.
        </p>

        <p className="text-sm">
          Reload the page. If the failure repeats, the state of your address can always be checked
          in a block explorer — the wallet is not needed for that.
        </p>

        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">What the browser reported</span>
          <span className="font-mono text-xs break-all">{reason}</span>
        </div>

        <button
          type="button"
          className="h-10 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
          onClick={() => {
            globalThis.location.reload()
          }}
        >
          Reload
        </button>

        <p className="text-xs text-muted-foreground">
          The seed phrase is not needed to reload: the wallet opens with the same password.
        </p>
      </div>
    )
  }
}
