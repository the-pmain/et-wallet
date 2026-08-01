import type { IClock, Timestamp, Unsubscribe } from '@/core'

/**
 * Управляемые часы для тестов.
 *
 * Время не идёт само: оно двигается только вызовом `advance`. Это делает
 * тесты таймаутов детерминированными и мгновенными — проверка автоблокировки
 * через пятнадцать минут не должна занимать пятнадцать минут.
 */
export class FakeClock implements IClock {
  #now: number

  readonly #timers = new Map<number, { at: number; handler: () => void; interval: number | null }>()

  #nextTimerId = 1

  constructor(startAt = 0) {
    this.#now = startAt
  }

  now(): Timestamp {
    return this.#now as Timestamp
  }

  setTimeout(handler: () => void, delayMs: number): Unsubscribe {
    const id = this.#nextTimerId++
    this.#timers.set(id, { at: this.#now + delayMs, handler, interval: null })

    return () => {
      this.#timers.delete(id)
    }
  }

  setInterval(handler: () => void, intervalMs: number): Unsubscribe {
    const id = this.#nextTimerId++
    this.#timers.set(id, { at: this.#now + intervalMs, handler, interval: intervalMs })

    return () => {
      this.#timers.delete(id)
    }
  }

  /** Двигает время вперёд и запускает наступившие таймеры. */
  advance(deltaMs: number): void {
    const target = this.#now + deltaMs

    /* Перебор в цикле, а не однократный проход: обработчик интервала
       может сработать несколько раз за один шаг. */
    let progressed = true

    while (progressed) {
      progressed = false

      for (const [id, timer] of [...this.#timers]) {
        if (timer.at > target) {
          continue
        }

        this.#now = timer.at

        if (timer.interval === null) {
          this.#timers.delete(id)
        } else {
          this.#timers.set(id, { ...timer, at: timer.at + timer.interval })
        }

        timer.handler()
        progressed = true
      }
    }

    this.#now = target
  }

  /** Число активных таймеров. Позволяет проверять отсутствие утечек. */
  get pendingTimers(): number {
    return this.#timers.size
  }
}
