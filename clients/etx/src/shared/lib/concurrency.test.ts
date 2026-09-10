import { describe, expect, it } from 'vitest'

import { mapWithLimit } from './concurrency'

/** Задача, завершающаяся после явного разрешения. */
function deferred<TValue>() {
  let resolve!: (value: TValue) => void
  let reject!: (reason: unknown) => void

  const promise = new Promise<TValue>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })

  return { promise, resolve, reject }
}

describe('mapWithLimit', () => {
  it('сохраняет порядок результатов', async () => {
    /* Список токенов показывается в заданном порядке; перестановка
       строк при каждом обновлении читалась бы как изменение состава. */
    const results = await mapWithLimit(
      [
        async () => await Promise.resolve('первый'),
        async () => await Promise.resolve('второй'),
        async () => await Promise.resolve('третий'),
      ],
      2,
    )

    expect(results.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))).toEqual([
      'первый',
      'второй',
      'третий',
    ])
  })

  it('не запускает больше задач, чем разрешено', async () => {
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()]

    let started = 0

    const running = mapWithLimit(
      gates.map((gate) => async () => {
        started += 1

        return await gate.promise
      }),
      2,
    )

    await Promise.resolve()

    expect(started).toBe(2)

    gates.forEach((gate, index) => {
      gate.resolve(index)
    })

    await running

    expect(started).toBe(3)
  })

  it('отказ одной задачи не отменяет остальные', async () => {
    /* Недоступный контракт не имеет права стереть с экрана балансы
       прочих токенов. */
    const results = await mapWithLimit(
      [
        async () => await Promise.resolve('есть'),
        () => Promise.reject(new Error('узел не ответил')),
        async () => await Promise.resolve('тоже есть'),
      ],
      2,
    )

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'есть' })
    expect(results[1]?.status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'тоже есть' })
  })

  it('сообщает причину отказа, а не проглатывает её', async () => {
    const results = await mapWithLimit([() => Promise.reject(new Error('лимит частоты'))], 4)
    const first = results[0]

    expect(first?.status === 'rejected' && first.reason).toBeInstanceOf(Error)
  })

  it('пустой список задач допустим', async () => {
    await expect(mapWithLimit([], 4)).resolves.toEqual([])
  })

  it('предел меньше единицы приводится к последовательному обходу', async () => {
    const order: number[] = []

    await mapWithLimit(
      [0, 1, 2].map((index) => async () => {
        order.push(index)

        return await Promise.resolve(index)
      }),
      0,
    )

    expect(order).toEqual([0, 1, 2])
  })
})
