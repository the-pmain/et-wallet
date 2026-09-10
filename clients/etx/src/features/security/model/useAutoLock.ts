import { AutoLockService, type IClock } from '@/core'
import { useEffect, useMemo, useState } from 'react'

/**
 * События браузера, считающиеся признаком присутствия пользователя.
 *
 * Движение указателя в список НЕ входит намеренно: курсор двигается
 * от случайного касания стола, и автоблокировка, продлеваемая этим,
 * не наступит никогда на брошенном ноутбуке.
 */
const ACTIVITY_EVENTS: readonly string[] = ['pointerdown', 'keydown', 'wheel', 'touchstart']

/** Состояние автоблокировки для интерфейса. */
export interface IAutoLockState {
  /** Показывать предупреждение о скорой блокировке. */
  readonly isWarning: boolean

  /** Сколько осталось до блокировки. `null`, пока отсчёт не идёт. */
  readonly remainingMs: number | null

  /** Продлевает сессию: вызывается кнопкой «остаться». */
  readonly extend: () => void
}

/** Параметры подключения автоблокировки. */
export interface IUseAutoLockParams {
  /** Отсчёт идёт только у разблокированного кошелька. */
  readonly isUnlocked: boolean

  readonly timeoutMs: number
  readonly clock: IClock

  /** Блокировка кошелька. Вызывается по истечении срока. */
  readonly onExpire: () => void
}

/**
 * Подключает автоблокировку к браузеру.
 *
 * ЯДРО СЧИТАЕТ ВРЕМЯ, ЭТОТ ХУК СЛУШАЕТ БРАУЗЕР. Разделение нужно, чтобы
 * `AutoLockService` оставался работоспособным в service worker, где нет
 * ни DOM, ни событий ввода.
 *
 * ПЕРЕХОД ВКЛАДКИ В ФОН СЧИТАЕТСЯ БЕЗДЕЙСТВИЕМ, А НЕ АКТИВНОСТЬЮ.
 * Обратное трактование продлевало бы сессию каждым переключением
 * окна — то есть ровно тогда, когда пользователь от кошелька отошёл.
 *
 * СОБЫТИЯ СЛУШАЮТСЯ В ФАЗЕ ПЕРЕХВАТА. Обработчик, остановивший
 * всплытие, иначе отменил бы продление сессии, и кошелёк блокировался
 * бы посреди работы.
 */
export function useAutoLock({
  isUnlocked,
  timeoutMs,
  clock,
  onExpire,
}: IUseAutoLockParams): IAutoLockState {
  const service = useMemo(() => new AutoLockService({ clock }, { timeoutMs }), [clock, timeoutMs])

  const [isWarning, setWarning] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  useEffect(() => {
    if (!isUnlocked) {
      /* Состояние здесь не сбрасывается: синхронный `setState` в теле
         эффекта вызывает каскадный рендер. Сброс выполняет очистка
         предыдущего запуска — она отрабатывает раньше этой ветки. */
      service.stop()

      return
    }

    const unsubscribeWarning = service.on('autolock:warning', ({ remainingMs: left }) => {
      setWarning(true)
      setRemainingMs(left)
    })

    const unsubscribeResumed = service.on('autolock:resumed', () => {
      setWarning(false)
      setRemainingMs(null)
    })

    const unsubscribeExpired = service.on('autolock:expired', () => {
      setWarning(false)
      setRemainingMs(null)
      onExpire()
    })

    const handleActivity = (): void => {
      service.notifyActivity()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { capture: true, passive: true })
    }

    service.start()

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity, { capture: true })
      }

      unsubscribeWarning()
      unsubscribeResumed()
      unsubscribeExpired()
      service.stop()

      /* Предупреждение снимается вместе с отсчётом: иначе оно всплыло бы
         сразу после следующей разблокировки, когда до блокировки ещё
         целый срок. */
      setWarning(false)
      setRemainingMs(null)
    }
  }, [isUnlocked, service, onExpire])

  return {
    isWarning,
    remainingMs,
    extend: () => {
      service.notifyActivity()
    },
  }
}
