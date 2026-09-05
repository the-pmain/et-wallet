import { describe, expect, it } from 'vitest'

import { mapWithLimit } from './concurrency'

/** Task that finishes after an explicit resolve. */
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
  it('preserves result order', async () => {
    /* The token list is shown in a given order; reshuffling rows on
       every refresh would read as a change in composition. */
    const results = await mapWithLimit(
      [
        async () => await Promise.resolve('first'),
        async () => await Promise.resolve('second'),
        async () => await Promise.resolve('third'),
      ],
      2,
    )

    expect(results.map((entry) => (entry.status === 'fulfilled' ? entry.value : null))).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('does not start more tasks than allowed', async () => {
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

  it('one task failing does not cancel the rest', async () => {
    /* An unreachable contract must not wipe other token balances
       off the screen. */
    const results = await mapWithLimit(
      [
        async () => await Promise.resolve('present'),
        () => Promise.reject(new Error('The node did not respond')),
        async () => await Promise.resolve('also present'),
      ],
      2,
    )

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'present' })
    expect(results[1]?.status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'also present' })
  })

  it('reports the failure reason instead of swallowing it', async () => {
    const results = await mapWithLimit([() => Promise.reject(new Error('rate limit'))], 4)
    const first = results[0]

    expect(first?.status === 'rejected' && first.reason).toBeInstanceOf(Error)
  })

  it('accepts an empty task list', async () => {
    await expect(mapWithLimit([], 4)).resolves.toEqual([])
  })

  it('a limit below one becomes sequential', async () => {
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
