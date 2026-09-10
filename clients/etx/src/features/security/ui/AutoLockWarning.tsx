import { Clock } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle, Button } from '@/shared/ui'

interface AutoLockWarningProps {
  readonly isVisible: boolean
  readonly remainingMs: number | null
  readonly onExtend: () => void
}

/**
 * Предупреждение о скорой автоблокировке.
 *
 * ЗАЧЕМ ОНО НУЖНО. Блокировка посреди заполнения формы отправки теряет
 * введённое, и без объяснения выглядит как сбой. Предупреждение даёт
 * продлить сессию одним нажатием и сообщает причину, если человек
 * отвлёкся и вернулся к экрану ввода пароля.
 *
 * ОНО НЕ ОТМЕНЯЕТ БЛОКИРОВКУ. Оставленное без внимания предупреждение
 * не мешает сроку истечь: иначе достаточно было бы не нажимать ничего,
 * и защита превратилась бы в необязательную.
 */
export function AutoLockWarning({ isVisible, remainingMs, onExtend }: AutoLockWarningProps) {
  if (!isVisible) {
    return null
  }

  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000)

  return (
    <Alert variant="warning" className="sticky top-2 z-30">
      <Clock />
      <AlertTitle>The wallet is about to lock</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          {seconds === null
            ? 'You have been inactive, and the session is about to close.'
            : `You have been inactive. The session closes in about ${String(seconds)} s.`}{' '}
          Your funds are not affected: only access closes, and the password brings it back.
        </span>

        <Button size="sm" onClick={onExtend}>
          Stay in the wallet
        </Button>
      </AlertDescription>
    </Alert>
  )
}
