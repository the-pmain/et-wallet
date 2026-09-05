import type { ISimulationRequest, ISimulationResult } from '@/core/transaction'
import type { ChainId } from '@/core/types'

/**
 * Simulation source.
 *
 * RETURNS `null`, NOT AN EMPTY RESULT, WHEN IT CANNOT ANSWER. That
 * is the main point of this interface. An `ISimulationResult` with
 * outcome "succeeded" and an empty movement list means "the
 * transaction does not move funds" — an assertion, not silence. A
 * source that did not parse the reply must stay silent and yield to
 * the next one, not issue that assertion in its own name.
 *
 * The `Unavailable` outcome inside a result remains for the case
 * when NO ONE could answer: the screen shows it.
 */
export interface ISimulationSource {
  /** Stable name for logs and settings. */
  readonly id: string

  /** Display name. The user is entitled to know who is being asked. */
  readonly name: string

  /**
   * Whether the source is ready to answer at all.
   *
   * THE NETWORK IS NOT PASSED HERE ON PURPOSE. The list of
   * supported networks at a third-party service changes without
   * notice, and a baked-in list would go stale silently — turning
   * the source off where it works. An unsupported network is
   * recognised from the reply, and that is an ordinary refusal
   * after which the node is asked.
   *
   * The check answers a different question: is the source
   * configured at all — is there a key and was consent given. It is
   * cheap and does not hit the network.
   */
  isAvailable(): boolean

  /** `null` — could not answer; ask the next one. */
  simulate(request: ISimulationRequest, chainId: ChainId): Promise<ISimulationResult | null>
}
