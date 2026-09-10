import { toAddress } from '@/core/address'
import type { ILogger } from '@/core/platform'
import {
  MOVEMENT_KIND,
  SIMULATION_OUTCOME,
  type IAssetMovement,
  type ISimulationRequest,
  type ISimulationResult,
  type MovementKind,
} from '@/core/transaction'
import type { Address, ChainId } from '@/core/types'

import type { ISimulationSource } from './contracts'

const SOURCE_ID = 'tenderly'
const SOURCE_NAME = 'Tenderly'

const DEFAULT_BASE_URL = 'https://api.tenderly.co/api/v1'

/** Reply wait limit. Simulation sits between the press and the signature. */
const DEFAULT_TIMEOUT_MS = 8000

/** Tenderly credentials. Without any of the three the source does not work. */
export interface ITenderlyCredentials {
  readonly account: string
  readonly project: string
  readonly accessKey: string
}

export interface ITenderlyOptions {
  readonly credentials: ITenderlyCredentials
  readonly logger: ILogger
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

/**
 * Simulation via Tenderly.
 *
 * WHAT THIS SOURCE ADDS TO THE NODE. The node replies with event
 * logs, and movements have to be assembled from them: an ether
 * transfer produces no events at all, and a token without a
 * `Transfer` event will not appear in the list. Tenderly returns
 * parsed balance changes, including native currency and internal
 * calls. Plus it does not refuse on rate: it has been measured that
 * public gateways reply to `eth_simulateV1` with `-32005`, and half
 * of public nodes do not know the method at all.
 *
 * WHAT THIS SOURCE COSTS. Every request tells the operator the
 * owner's address, the recipient, the amount, and the call data —
 * that is, the intent to spend, BEFORE the signature. That is more
 * than the node learns: the node sees a transaction already gone
 * to the network, and here even what the owner eventually declined
 * is visible. Therefore the source is turned on only by explicit
 * consent and is never on by default.
 *
 * `save` AND `save_if_fails` ARE ALWAYS FALSE. By default the
 * service stores the simulation in the project panel — that is,
 * the owner's intents would sit on someone else's servers forever.
 * An explicit "do not save" is sent.
 */
export class TenderlySimulationProvider implements ISimulationSource {
  readonly id = SOURCE_ID
  readonly name = SOURCE_NAME

  readonly #credentials: ITenderlyCredentials
  readonly #logger: ILogger
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: ITenderlyOptions) {
    this.#credentials = options.credentials
    this.#logger = options.logger.child(SOURCE_NAME)
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Networks are not listed on purpose.
   *
   * Tenderly supports dozens of networks and adds new ones; a
   * baked-in list would go stale silently and turn the source off
   * where it works. An unsupported network is recognised from the
   * reply, and that is an ordinary refusal — the fallback through
   * the node remains.
   */
  isAvailable(): boolean {
    return (
      this.#credentials.account !== '' &&
      this.#credentials.project !== '' &&
      this.#credentials.accessKey !== ''
    )
  }

  async simulate(request: ISimulationRequest, chainId: ChainId): Promise<ISimulationResult | null> {
    if (!this.isAvailable()) {
      return null
    }

    const { account, project, accessKey } = this.#credentials
    const url = `${this.#baseUrl}/account/${account}/project/${project}/simulate`

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, this.#timeoutMs)

    try {
      const response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          /* The key goes in a header, not the query string: the
             query string settles in intermediate-node logs. */
          'X-Access-Key': accessKey,
        },
        body: JSON.stringify({
          network_id: chainId.toString(),
          from: request.from,
          to: request.to,
          input: request.data,
          value: request.value.toString(),
          save: false,
          save_if_fails: false,
          simulation_type: 'full',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        this.#logger.warn('Tenderly refused the simulation', { status: response.status })

        return null
      }

      return parseSimulation(await response.json())
    } catch (error) {
      this.#logger.warn('Tenderly did not answer', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Parses a Tenderly reply.
 *
 * THE REPLY SHAPE HAS NOT BEEN MEASURED ON THE LIVE SERVICE. It is
 * taken from the description, and this project has already been
 * burned that way: the native-currency pseudo-address had to be
 * measured on a live node because implementations diverged from
 * the convention. Therefore parsing is strict and on any surprise
 * returns `null` — "could not answer", after which the node is
 * asked.
 *
 * THIS IS NOT OVER-CAUTION. Soft parsing that skips the
 * unrecognised would issue "succeeded, no movements" — and an
 * empty list on success means "the transaction does not move
 * funds". The owner would read that as a safety confirmation of a
 * call that in fact empties the wallet.
 *
 * THE FIRST LIVE REPLY MUST BE CHECKED against this parser, and
 * until then the source should be treated as unverified.
 */
export function parseSimulation(payload: unknown): ISimulationResult | null {
  if (!isRecord(payload)) {
    return null
  }

  const simulation = payload['simulation']

  if (!isRecord(simulation)) {
    return null
  }

  const status = simulation['status']

  if (typeof status !== 'boolean') {
    return null
  }

  const gasUsed = readBigInt(simulation['gas_used'])
  const reason =
    typeof simulation['error_message'] === 'string' ? simulation['error_message'] : null

  if (!status) {
    /* Revert: there will be no movements, and an empty list here
       means exactly that, not "could not parse". */
    return {
      outcome: SIMULATION_OUTCOME.Reverted,
      gasUsed,
      movements: [],
      reason,
    }
  }

  const movements = readMovements(payload)

  if (movements === null) {
    return null
  }

  return {
    outcome: SIMULATION_OUTCOME.Succeeded,
    gasUsed,
    movements,
    reason: null,
  }
}

/**
 * Reads balance changes.
 *
 * `null` — the field is missing or is not shaped as expected here.
 * A missing field is NOT the same as no movements: the service may
 * have omitted it for a dozen reasons, and presenting that as
 * "funds do not move" is not allowed.
 */
function readMovements(payload: Record<string, unknown>): readonly IAssetMovement[] | null {
  const transaction = payload['transaction']

  if (!isRecord(transaction)) {
    return null
  }

  const info = transaction['transaction_info']

  if (!isRecord(info)) {
    return null
  }

  const changes = info['asset_changes']

  /* An empty array is a lawful reply: the transaction moves
     nothing. A missing field is not — that is silence. */
  if (changes === null || changes === undefined) {
    return null
  }

  if (!Array.isArray(changes)) {
    return null
  }

  const movements: IAssetMovement[] = []

  for (const change of changes) {
    const movement = readMovement(change)

    if (movement === null) {
      return null
    }

    movements.push(movement)
  }

  return movements
}

function readMovement(change: unknown): IAssetMovement | null {
  if (!isRecord(change)) {
    return null
  }

  const from = readAddress(change['from'])
  const to = readAddress(change['to'])

  if (from === null || to === null) {
    return null
  }

  const tokenInfo = isRecord(change['token_info']) ? change['token_info'] : null
  const contract = tokenInfo === null ? null : readAddress(tokenInfo['contract_address'])
  const kind = readKind(tokenInfo?.['standard'], contract)

  if (kind === null) {
    return null
  }

  return {
    kind,
    contract: kind === MOVEMENT_KIND.Native ? null : contract,
    from,
    to,
    /* `raw_amount` is the quantity in smallest units. The `amount`
       field on the same change arrives as a fractional number and
       is unfit for display: the wallet counts amounts as integers. */
    amount: readBigInt(change['raw_amount']),
    tokenId: readBigInt(change['token_id']),
  }
}

/** Kind mapping. An unknown kind is a reason to stay silent, not to guess. */
function readKind(standard: unknown, contract: Address | null): MovementKind | null {
  if (contract === null) {
    return MOVEMENT_KIND.Native
  }

  if (typeof standard !== 'string') {
    return null
  }

  switch (standard.toUpperCase()) {
    case 'ERC20':
      return MOVEMENT_KIND.Erc20
    case 'ERC721':
      return MOVEMENT_KIND.Erc721
    case 'ERC1155':
      return MOVEMENT_KIND.Erc1155
    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAddress(value: unknown): Address | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    return toAddress(value)
  } catch {
    return null
  }
}

/** The number arrives as a string. `null` — no field, or it is not a number. */
function readBigInt(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  if (typeof value !== 'string' || value === '') {
    return null
  }

  try {
    return BigInt(value)
  } catch {
    return null
  }
}
