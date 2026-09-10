import { GasEstimationFailedError } from '@/core/errors'
import type { IProvider } from '@/core/provider'
import {
  SELECTOR_LENGTH,
  WORD_LENGTH,
  decodeUint,
  functionSelector,
  strip,
} from '@/core/abi/encoding'
import type { Address, HexString, Wei } from '@/core/types'

/**
 * Marker of the standard revert reason: `Error(string)`.
 *
 * Defined in Solidity and returned by any `require` with a string.
 */
const ERROR_STRING_SELECTOR = functionSelector('Error(string)')

const PANIC_SELECTOR = functionSelector('Panic(uint256)')

/**
 * Panic-code values.
 *
 * Taken from the Solidity docs. Translated into words, because
 * "panic 0x11" tells the funds owner nothing, while "an arithmetic
 * operation overflowed" points at the amount they typed.
 */
const PANIC_REASONS: ReadonlyMap<bigint, string> = new Map([
  [0x01n, 'an assertion inside the contract failed'],
  [0x11n, 'an arithmetic operation overflowed'],
  [0x12n, 'a division by zero'],
  [0x21n, 'a value outside the allowed set was passed'],
  [0x22n, 'a malformed storage array'],
  [0x31n, 'an attempt to remove an element from an empty array'],
  [0x32n, 'an index outside the array bounds'],
  [0x41n, 'the contract ran out of memory'],
  [0x51n, 'a call to an uninitialised internal function'],
])

/**
 * Calls whose rejection is a returned value, not a revert.
 *
 * THIS IS NOT A THEORETICAL CASE. ERC-20 requires `transfer` to
 * return a success flag, and some contracts return `false` on
 * insufficient funds or a ban instead of reverting. The transaction
 * then lands in a block and looks done: gas was spent, state did
 * not change, and the wallet reports a send.
 */
const BOOLEAN_RESULT_SELECTORS: ReadonlySet<string> = new Set([
  functionSelector('transfer(address,uint256)'),
  functionSelector('transferFrom(address,address,uint256)'),
  functionSelector('approve(address,uint256)'),
])

/** How the preflight run ended. */
export const PREFLIGHT_OUTCOME = {
  /** The node ran the call on current state without a revert. */
  Passed: 'passed',

  /** The call reverted: sending it would burn gas for nothing. */
  Reverted: 'reverted',

  /**
   * The contract rejected with a returned value, without reverting.
   *
   * More dangerous than a revert: the transaction will land in a
   * block and look done.
   */
  RejectedByContract: 'rejected-by-contract',

  /**
   * Could not check.
   *
   * DISTINGUISHING FROM SUCCESS IS REQUIRED. An unreachable node
   * confirms nothing, and treating its silence as "checked" would
   * put a signature under an unchecked call.
   */
  Unavailable: 'unavailable',
} as const

export type PreflightOutcome = (typeof PREFLIGHT_OUTCOME)[keyof typeof PREFLIGHT_OUTCOME]

export interface IPreflightResult {
  readonly outcome: PreflightOutcome

  /**
   * Rejection reason in words. `null` — the reason is unknown.
   *
   * Comes from the contract and is shown verbatim.
   */
  readonly reason: string | null

  /**
   * Raw revert data.
   *
   * Needed when the reason cannot be parsed: a custom contract
   * error is a four-byte marker that can be looked up, while
   * "the call was rejected" says nothing.
   */
  readonly revertData: string | null
}

export interface IPreflightRequest {
  readonly from: Address

  /** `null` — a contract deploy. */
  readonly to: Address | null

  readonly data: HexString
  readonly value: Wei
}

/**
 * Runs the transaction on the node before signing.
 *
 * WHAT THIS IS. An `eth_call` with the same fields that will go
 * on-chain: the node runs it on current chain state and publishes
 * nothing. A failure here means the real transaction will revert too.
 *
 * WHAT THIS IS NOT. This is not a prediction of balance changes:
 * those need a call trace or state override, and public nodes
 * provide neither. Calling this check a "simulation" would promise
 * more than was done.
 *
 * STATE CHANGES BETWEEN THE CHECK AND INCLUSION. The check speaks
 * of state at call time, not of the future: an allowance may be
 * revoked, and funds spent by another transaction. A passed check
 * does not promise execution, and the UI must say so just as plainly.
 *
 * A CONTRACT DEPLOY IS NOT CHECKED: `eth_call` without a recipient
 * returns the future contract's bytecode, not a success flag, and
 * there is nothing to judge by.
 */
export async function preflightCall(
  provider: IProvider,
  request: IPreflightRequest,
): Promise<IPreflightResult> {
  if (request.to === null) {
    return { outcome: PREFLIGHT_OUTCOME.Unavailable, reason: null, revertData: null }
  }

  const to = request.to

  try {
    const result = await provider.call({
      to,
      from: request.from,
      data: request.data,
      value: request.value,
    })

    return interpretResult(request.data, result)
  } catch (error) {
    return interpretFailure(error)
  }
}

/**
 * Interprets a successful node response.
 *
 * Absence of a revert does not yet mean the contract agreed: for
 * calls with a boolean result, rejection is the value `false`.
 */
function interpretResult(data: HexString, result: HexString): IPreflightResult {
  const passed: IPreflightResult = {
    outcome: PREFLIGHT_OUTCOME.Passed,
    reason: null,
    revertData: null,
  }

  if (!BOOLEAN_RESULT_SELECTORS.has(strip(data).slice(0, SELECTOR_LENGTH))) {
    return passed
  }

  const body = strip(result)

  /* An empty answer to a call with a declared boolean result is
     ordinary behaviour of contracts written before the standard
     was tightened. Absence of `false` is read in favour of success:
     treating such a call as a reject would forbid working with them. */
  if (body.length < WORD_LENGTH) {
    return passed
  }

  if (decodeUint(result) !== 0n) {
    return passed
  }

  return {
    outcome: PREFLIGHT_OUTCOME.RejectedByContract,
    reason:
      'the contract returned "false" instead of reverting: the transaction would be included in a block and change nothing',
    revertData: null,
  }
}

function interpretFailure(error: unknown): IPreflightResult {
  if (!(error instanceof GasEstimationFailedError)) {
    /* The node is unreachable or answered off-topic. That is not
       a call reject, and must not be presented as a revert: the
       user would be fixing a non-existent error in their transaction. */
    return { outcome: PREFLIGHT_OUTCOME.Unavailable, reason: null, revertData: null }
  }

  const revertData = error.revertData

  return {
    outcome: PREFLIGHT_OUTCOME.Reverted,
    reason: decodeRevertReason(revertData) ?? error.reason,
    revertData,
  }
}

/**
 * Parses revert data.
 *
 * Three cases, and all three are distinguishable: a standard string
 * reason, a runtime panic by code, and a custom contract error
 * about which nothing can be said without its description.
 */
export function decodeRevertReason(revertData: string | null): string | null {
  if (revertData === null) {
    return null
  }

  const body = strip(revertData)

  if (body.length < SELECTOR_LENGTH) {
    return null
  }

  const selector = body.slice(0, SELECTOR_LENGTH)
  const payload = body.slice(SELECTOR_LENGTH)

  if (selector === ERROR_STRING_SELECTOR) {
    return decodeErrorString(payload)
  }

  if (selector === PANIC_SELECTOR) {
    if (payload.length < WORD_LENGTH) {
      return null
    }

    const code = decodeUint(`0x${payload}` as HexString)

    return PANIC_REASONS.get(code) ?? `an internal contract error, code ${code.toString()}`
  }

  /* A custom contract error. It cannot be decoded without the
     contract's description, and inventing a reading is not allowed:
     the marker is shown as-is, and the reason can be looked up from it. */
  return `the contract rejected the call with its own error 0x${selector}`
}

/**
 * Reads the reason string from `Error(string)`.
 *
 * The data is untrusted: the node may have returned a truncated
 * or corrupted answer, and parsing must end in "no reason", not
 * an exception on top of a revert that already happened.
 */
function decodeErrorString(payload: string): string | null {
  const body = payload

  if (body.length < WORD_LENGTH * 2) {
    return null
  }

  const length = Number(BigInt(`0x${body.slice(WORD_LENGTH, WORD_LENGTH * 2)}`))
  const text = body.slice(WORD_LENGTH * 2, WORD_LENGTH * 2 + length * 2)

  if (length === 0 || text.length < length * 2) {
    return null
  }

  const bytes = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
  }

  const decoded = new TextDecoder().decode(bytes)

  /* Control characters in the reason are a sign of corrupted data
     or an attempt to forge the look of a wallet message. Such a
     string is not shown. */
  return /[\p{Cc}]/u.test(decoded) ? null : decoded
}
