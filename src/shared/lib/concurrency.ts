/**
 * Runs tasks with a concurrency limit.
 *
 * WHY A LIMIT, NOT `Promise.all`. Public RPC nodes rate-limit:
 * a dozen simultaneous calls get a refusal instead of an answer, and
 * instead of a speedup the screen is empty. The other extreme —
 * strictly sequential work — spends ten network delays on ten tokens
 * in a row.
 *
 * WHY A LIMIT, NOT `Promise.all` — SECOND REASON. Simultaneous
 * requests to one node hand an observer the whole portfolio in one
 * packet. A stream of a few tasks blurs that picture without
 * removing it.
 *
 * RESULT ORDER MATCHES TASK ORDER. The token list is shown in a
 * given order, and reshuffling rows on every refresh would read as
 * a change in composition.
 *
 * ONE TASK FAILING DOES NOT CANCEL THE REST, unlike `Promise.all`:
 * an unreachable contract must not wipe every other token balance
 * off the screen. The failure reason is returned to the caller, not
 * swallowed.
 */

export type SettledResult<TValue> =
  | { readonly status: 'fulfilled'; readonly value: TValue }
  | { readonly status: 'rejected'; readonly reason: unknown }

/**
 * @param tasks Tasks. Functions, not promises: a promise starts
 *        running when it is created, and there would already be
 *        nothing to limit.
 * @param limit How many tasks run at once. Values below one are
 *        raised to one.
 */
export async function mapWithLimit<TValue>(
  tasks: readonly (() => Promise<TValue>)[],
  limit: number,
): Promise<readonly SettledResult<TValue>[]> {
  const results = new Array<SettledResult<TValue>>(tasks.length)
  const width = Math.max(1, Math.min(Math.floor(limit), tasks.length))

  /* One iterator for every worker. Taking the next task is
     synchronous, and JavaScript has one execution thread, so two
     tasks will not go to one worker. A counter with a manual bound
     check would do the same at the cost of an index the type system
     treats as possibly empty. */
  const queue = tasks.entries()

  async function worker(): Promise<void> {
    for (const [index, task] of queue) {
      try {
        results[index] = { status: 'fulfilled', value: await task() }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))

  return results
}
