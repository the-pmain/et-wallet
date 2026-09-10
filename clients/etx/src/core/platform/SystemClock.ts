import type { Timestamp, Unsubscribe } from '@/core/types'

import type { IClock } from './Clock'

/**
 * Часы поверх системного времени и таймеров платформы.
 *
 * Единственная боевая реализация `IClock`. Прикладной код обращается
 * к времени только через внедрённый экземпляр — прямые вызовы `Date.now`
 * делают поведение автоблокировки непроверяемым тестами.
 *
 * ОТМЕНА ВМЕСТО ИДЕНТИФИКАТОРА. Методы возвращают функцию отмены, а не число:
 * тип идентификатора таймера различается в браузере и в Node, и вызывающий
 * код не должен о нём знать. Дополнительно это исключает ошибку «отменил
 * чужой таймер по совпавшему числу».
 */
export class SystemClock implements IClock {
  now(): Timestamp {
    return Date.now() as Timestamp
  }

  setTimeout(handler: () => void, delayMs: number): Unsubscribe {
    const id = globalThis.setTimeout(handler, delayMs)

    return () => {
      globalThis.clearTimeout(id)
    }
  }

  setInterval(handler: () => void, intervalMs: number): Unsubscribe {
    const id = globalThis.setInterval(handler, intervalMs)

    return () => {
      globalThis.clearInterval(id)
    }
  }
}
