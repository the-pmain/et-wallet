import { toAddress } from '@/core/address'
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  TRANSFER_TOPIC,
  hexToBigInt,
  splitDataWords,
  topicToAddress,
} from '@/core/history'
import type { ILogEntry, IProvider } from '@/core/provider'
import type { Address, HexString, Wei } from '@/core/types'

import { decodeRevertReason } from './preflight'

/**
 * Native-currency pseudo-address (ERC-7528).
 *
 * An ether transfer emits no events, so with `traceTransfers` the
 * node appends a synthetic log at this address with an ordinary
 * `Transfer` event. The value was measured on a live node, not taken
 * from a write-up: the convention is young, and implementations may
 * have diverged.
 */
const NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/** JSON-RPC code "method does not exist". */
const JSON_RPC_METHOD_NOT_FOUND = -32601

/** Topic count of an ERC-721 event: the event id plus three parameters. */
const ERC721_TOPIC_COUNT = 4

/** How the simulation ended. */
export const SIMULATION_OUTCOME = {
  /** The node ran the transaction on current state and returned its effects. */
  Succeeded: 'succeeded',

  /** The transaction will revert: sending it would burn gas for nothing. */
  Reverted: 'reverted',

  /**
   * The node cannot do `eth_simulateV1`.
   *
   * SEPARATE FROM "FAILED". The method is missing — that is a node
   * property that a retry will not change, and the owner should know
   * the issue is the node, not their transaction.
   */
  Unsupported: 'unsupported',

  /**
   * The node did not answer or refused.
   *
   * DISTINGUISHING FROM SUCCESS IS REQUIRED. Node silence confirms
   * nothing; treating it as "no changes" would show an empty list
   * where the list is unknown.
   */
  Unavailable: 'unavailable',
} as const

export type SimulationOutcome = (typeof SIMULATION_OUTCOME)[keyof typeof SIMULATION_OUTCOME]

/** What kind of asset is moving. */
export const MOVEMENT_KIND = {
  Native: 'native',
  Erc20: 'erc20',
  Erc721: 'erc721',
  Erc1155: 'erc1155',
} as const

export type MovementKind = (typeof MOVEMENT_KIND)[keyof typeof MOVEMENT_KIND]

/** One asset movement that will happen on send. */
export interface IAssetMovement {
  readonly kind: MovementKind

  /** Contract address. `null` — the network native currency. */
  readonly contract: Address | null

  readonly from: Address
  readonly to: Address

  /**
   * Amount in smallest units.
   *
   * `null` means "the movement is known to exist, but how much
   * could not be parsed". A zero here would be a claim about the
   * amount that the simulation did not make.
   */
  readonly amount: bigint | null

  /** Item id for ERC-721 and ERC-1155. */
  readonly tokenId: bigint | null
}

/** Simulation result. */
export interface ISimulationResult {
  readonly outcome: SimulationOutcome

  /** Gas used. `null` — the node did not report it. */
  readonly gasUsed: bigint | null

  /**
   * Asset movements in the order they occur.
   *
   * An empty list is MEANINGFUL only on outcome `succeeded`: it
   * means the transaction moves no assets at all. On other outcomes
   * the list is empty because there is no information.
   */
  readonly movements: readonly IAssetMovement[]

  /** Revert reason in words. `null` — unknown. */
  readonly reason: string | null
}

/** What is being simulated. */
export interface ISimulationRequest {
  readonly from: Address

  /** `null` — contract deployment. */
  readonly to: Address | null

  readonly data: HexString
  readonly value: Wei
}

/** Result when simulation was not run. */
export const UNCHECKED_SIMULATION: ISimulationResult = {
  outcome: SIMULATION_OUTCOME.Unavailable,
  gasUsed: null,
  movements: [],
  reason: null,
}

/**
 * Shows what a transaction will do, before signing.
 *
 * HOW THIS DIFFERS FROM A `preflightCall` RUN. The run answers
 * "will it go through", simulation answers "what will happen". The
 * first protects against burned gas, the second against signing
 * something the person did not mean: the screen shows the recipient
 * and amount taken from form fields, and the movements are what the
 * node computed by executing the call. A mismatch between them is
 * the sign of a swap.
 *
 * WHY THIS IS THE DEFAULT PATH. `eth_simulateV1` is an ordinary node
 * method the wallet already talks to: no key, no account, no extra
 * operator learning the owner's intent.
 *
 * It used to say a third-party service was not needed at all. That
 * turned out to be wrong in one part: log parsing cannot see what
 * is not in the logs, and public nodes either do not know the method
 * or refuse on rate — measured. So a third-party source was added
 * (`core/simulation`), but as an ADDITION: it is asked first only
 * with the owner's explicit consent, and the node remains the base
 * and is always queried when the source stayed silent.
 *
 * NODE SUPPORT VARIES, and that is the usual state of affairs, not
 * an exception: measured that some public nodes do not know the
 * method and some refuse on rate. Both cases are distinguished in
 * the outcome and are not treated as "no changes".
 *
 * SIMULATION IS NOT A GUARANTEE. It ran on chain state at this
 * moment; by inclusion time the state may be different. The UI must
 * say "will happen on current state", not "will happen".
 */
export async function simulateTransaction(
  provider: IProvider,
  request: ISimulationRequest,
): Promise<ISimulationResult> {
  let response: unknown

  try {
    response = await provider.request({
      method: 'eth_simulateV1',
      params: [
        {
          blockStateCalls: [
            {
              calls: [
                {
                  from: request.from,
                  ...(request.to === null ? {} : { to: request.to }),
                  data: request.data,
                  value: `0x${request.value.toString(16)}`,
                },
              ],
            },
          ],
          /* Without this a native-currency transfer is invisible:
             it emits no events, and the movement list would be empty
             for the most ordinary send. */
          traceTransfers: true,
          /* Balance and nonce checks are off on purpose. Fee
             estimation and the call run already check them, and a
             refusal here for insufficient funds would hide the one
             thing simulation exists for — the movement list. */
          validation: false,
        },
        'latest',
      ],
    })
  } catch (error) {
    return {
      ...UNCHECKED_SIMULATION,
      outcome: isMethodNotFound(error)
        ? SIMULATION_OUTCOME.Unsupported
        : SIMULATION_OUTCOME.Unavailable,
    }
  }

  return readResponse(response)
}

/**
 * Parses the node response.
 *
 * The response is untrusted: the node may return anything, so each
 * field is checked separately, and an unexpected shape yields "could
 * not check", not an exception in the middle of preparing a
 * transaction.
 */
function readResponse(response: unknown): ISimulationResult {
  if (!Array.isArray(response)) {
    return UNCHECKED_SIMULATION
  }

  const block = response[0] as { calls?: unknown } | undefined
  const calls = block?.calls

  if (!Array.isArray(calls)) {
    return UNCHECKED_SIMULATION
  }

  const call = calls[0] as
    { status?: unknown; gasUsed?: unknown; returnData?: unknown; logs?: unknown } | undefined

  if (call === undefined) {
    return UNCHECKED_SIMULATION
  }

  const gasUsed = typeof call.gasUsed === 'string' ? hexToBigInt(call.gasUsed) : null

  /* The success flag on `eth_simulateV1` is the same as on a receipt:
     `0x1` — executed, `0x0` — revert. */
  if (call.status !== '0x1') {
    return {
      outcome: SIMULATION_OUTCOME.Reverted,
      gasUsed,
      movements: [],
      reason: typeof call.returnData === 'string' ? decodeRevertReason(call.returnData) : null,
    }
  }

  return {
    outcome: SIMULATION_OUTCOME.Succeeded,
    gasUsed,
    movements: Array.isArray(call.logs) ? readMovements(call.logs as readonly unknown[]) : [],
    reason: null,
  }
}

/** Picks from the logs those that mean an asset movement. */
function readMovements(logs: readonly unknown[]): readonly IAssetMovement[] {
  const movements: IAssetMovement[] = []

  for (const entry of logs) {
    const log = entry as Partial<ILogEntry>

    if (typeof log.address !== 'string' || !Array.isArray(log.topics)) {
      continue
    }

    const movement = readMovement(
      log.address,
      log.topics as readonly HexString[],
      /* Empty data is a legal case: on ERC-721 everything lives in
         topics. The cast here is safe: `splitDataWords` parses the
         string character by character and returns an empty list on
         empty input. */
      log.data ?? ('0x' as HexString),
    )

    if (movement !== null) {
      movements.push(movement)
    }
  }

  return movements
}

/**
 * Parses one log into a movement.
 *
 * EVENT GRAMMAR IS THE SAME AS TRANSFER HISTORY, and parsing here is
 * separate: history builds a record with a block, a time, and a
 * source, and confirmation is a movement with no chain binding,
 * because none of that has happened yet. What is shared are the
 * event ids: they cannot be gotten wrong twice, they come from one
 * place.
 *
 * UNPARSED IS NOT DROPPED IN SILENCE where the event is recognized:
 * the amount may stay unknown, but the fact of the movement reaches
 * the screen. Omitting a movement is more dangerous than incompleteness.
 */
function readMovement(
  address: string,
  topics: readonly HexString[],
  data: HexString,
): IAssetMovement | null {
  const [topic, first, second, third] = topics

  if (topic === undefined) {
    return null
  }

  const isNative = address.toLowerCase() === NATIVE_ASSET_ADDRESS
  const contract = isNative ? null : toAddress(address)
  const words = splitDataWords(data)

  if (topic === TRANSFER_TOPIC && first !== undefined && second !== undefined) {
    const isErc721 = topics.length === ERC721_TOPIC_COUNT && third !== undefined

    return {
      kind: isNative ? MOVEMENT_KIND.Native : isErc721 ? MOVEMENT_KIND.Erc721 : MOVEMENT_KIND.Erc20,
      contract,
      from: topicToAddress(first),
      to: topicToAddress(second),
      amount: isErc721 ? 1n : (words[0] ?? null),
      tokenId: isErc721 && third !== undefined ? hexToBigInt(third) : null,
    }
  }

  if (topic === TRANSFER_SINGLE_TOPIC && second !== undefined && third !== undefined) {
    return {
      kind: MOVEMENT_KIND.Erc1155,
      contract,
      from: topicToAddress(second),
      to: topicToAddress(third),
      amount: words[1] ?? null,
      tokenId: words[0] ?? null,
    }
  }

  if (topic === TRANSFER_BATCH_TOPIC && second !== undefined && third !== undefined) {
    /* A batch transfer contains arrays of ids and amounts. Parsing
       them here is unnecessary: on the confirmation screen the fact
       that items are leaving matters, and listing them one by one
       is history's job, where the event has already happened. The
       amount stays unknown, and that is said by `null`, not zero. */
    return {
      kind: MOVEMENT_KIND.Erc1155,
      contract,
      from: topicToAddress(second),
      to: topicToAddress(third),
      amount: null,
      tokenId: null,
    }
  }

  return null
}

/** Distinguishes "no such method" from other node refusals. */
function isMethodNotFound(error: unknown): boolean {
  const code = (error as { rpcCode?: unknown }).rpcCode

  return code === JSON_RPC_METHOD_NOT_FOUND
}
