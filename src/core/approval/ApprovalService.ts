import { NetworkNotFoundError } from '@/core/errors'
import { addressToTopic, topicToAddress } from '@/core/history'
import type { INetworkService } from '@/core/network'
import { decodeBool } from '@/core/nft'
import type { ILogger } from '@/core/platform'
import type { ILogEntry, IProvider, IProviderResolver } from '@/core/provider'
import {
  DECIMALS_SELECTOR,
  SYMBOL_SELECTOR,
  TOKEN_STANDARD,
  decodeString,
  decodeUint,
  encodeCall,
  type TokenStandard,
} from '@/core/token'
import type { Address, ChainId, HexString } from '@/core/types'

import {
  ALLOWANCE_SELECTOR,
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  ERC20_APPROVAL_TOPIC_COUNT,
  IS_APPROVED_FOR_ALL_SELECTOR,
  encodeAllowance,
} from './abi'
import type { IApprovalPage, IApprovalRecord } from './types'

const SERVICE_NAME = 'ApprovalService'

/**
 * Sample depth in blocks.
 *
 * The same value as history and collectibles: public nodes cap the
 * `eth_getLogs` range, and ten thousand blocks are accepted by almost
 * all of them.
 */
const DEFAULT_SCAN_BLOCKS = 10_000

/**
 * How many allowances are checked for being live.
 *
 * Each check is a contract call. An active address may have hundreds
 * of grants; a full check would exhaust the node's limits.
 */
const MAX_CHECKED_ITEMS = 60

const BATCH_SIZE = 8

/**
 * Threshold from which an allowance is treated as unlimited.
 *
 * Apps request either the full `uint256` or nearby values such as
 * `2^255`. An exact-equality comparison would miss the latter, and
 * the difference between "the whole balance" and "almost the whole
 * balance" does not exist for the owner.
 */
const UNLIMITED_THRESHOLD = 1n << 200n

export interface IApprovalServiceDependencies {
  readonly resolver: IProviderResolver
  readonly networks: INetworkService
  readonly logger: ILogger
  readonly scanBlocks?: number
}

interface ICandidate {
  readonly contract: Address
  readonly spender: Address
  readonly standard: TokenStandard
}

interface IScanResult {
  readonly logs: readonly ILogEntry[]
  readonly failed: number
  readonly total: number
  readonly reason: string | null
}

/**
 * Allowances granted by an address.
 *
 * HOW IT WORKS. The node does not keep a "who is allowed what" list:
 * the service finds grant events in the logs, then asks each contract
 * whether the allowance is live NOW — `allowance` for tokens,
 * `isApprovedForAll` for collections.
 *
 * BOTH STEPS ARE REQUIRED. The log stores history: a revoked
 * allowance stays there forever. A list from the logs alone would
 * scare the owner with what has long been gone, and devalue real
 * findings.
 *
 * THE SERVICE REVOKES NOTHING. A revoke is a transaction the owner
 * signs; the transaction layer prepares it. This is read-only.
 */
export class ApprovalService {
  readonly #resolver: IProviderResolver
  readonly #networks: INetworkService
  readonly #logger: ILogger
  readonly #scanBlocks: number

  /* Token metadata lives until the session ends: it does not
     change. A promise is stored, not a result: checks run in
     parallel, and a cache of finished values would not fill in time. */
  readonly #tokens = new Map<string, Promise<{ symbol: string | null; decimals: number | null }>>()

  constructor(dependencies: IApprovalServiceDependencies) {
    this.#resolver = dependencies.resolver
    this.#networks = dependencies.networks
    this.#logger = dependencies.logger.child(SERVICE_NAME)
    this.#scanBlocks = dependencies.scanBlocks ?? DEFAULT_SCAN_BLOCKS
  }

  /**
   * Returns the owner's live allowances.
   *
   * A node rejection is not thrown outward: the list stays empty
   * and the reason goes into `limits`. An empty list without an
   * explanation reads as "you have allowed nothing to anyone" —
   * a claim the wallet is not entitled to make in that case.
   */
  async list(owner: Address, chainId: ChainId): Promise<IApprovalPage> {
    const network = this.#networks.getByChainId(chainId)

    if (network === null) {
      throw new NetworkNotFoundError(chainId)
    }

    let provider: IProvider
    let scan: IScanResult

    try {
      provider = await this.#resolver.get(network)

      const latest = await provider.getBlockNumber()
      const fromBlock = latest > BigInt(this.#scanBlocks) ? latest - BigInt(this.#scanBlocks) : 0n

      scan = await this.#fetchApprovals(provider, owner, fromBlock, latest)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      this.#logger.warn('The list of approvals is unavailable', { reason })

      return {
        items: [],
        limits: { scannedBlocks: null, sourceUnavailable: true, reason, skipped: 0 },
      }
    }

    if (scan.failed === scan.total) {
      return {
        items: [],
        limits: {
          scannedBlocks: null,
          sourceUnavailable: true,
          reason: scan.reason,
          skipped: 0,
        },
      }
    }

    const candidates = collectCandidates(scan.logs)
    const checked = candidates.slice(0, MAX_CHECKED_ITEMS)
    const items = await this.#keepActive(provider, owner, chainId, checked)

    return {
      items,
      limits: {
        scannedBlocks: this.#scanBlocks,
        sourceUnavailable: false,
        reason: null,
        skipped: candidates.length - checked.length,
      },
    }
  }

  /** Forgets token metadata. Called when the session closes. */
  clear(): void {
    this.#tokens.clear()
  }

  /**
   * Grant logs where the owner is the given address.
   *
   * TWO REQUESTS, because the events differ: tokens use `Approval`,
   * collections use `ApprovalForAll`. The owner is indexed first in both.
   */
  async #fetchApprovals(
    provider: IProvider,
    owner: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<IScanResult> {
    const ownerTopic = addressToTopic(owner)

    const queries: readonly (readonly (HexString | null)[])[] = [
      [APPROVAL_TOPIC, ownerTopic],
      [APPROVAL_FOR_ALL_TOPIC, ownerTopic],
    ]

    let reason: string | null = null

    const results = await Promise.all(
      queries.map(async (topics) => {
        try {
          return await provider.getLogs({ fromBlock, toBlock, topics })
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error)

          this.#logger.warn('The node rejected the log query', { reason })

          return null
        }
      }),
    )

    return {
      logs: results.filter((entries) => entries !== null).flat(),
      failed: results.filter((entries) => entries === null).length,
      total: results.length,
      reason,
    }
  }

  async #keepActive(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidates: readonly ICandidate[],
  ): Promise<readonly IApprovalRecord[]> {
    const active: IApprovalRecord[] = []

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE)

      const checked = await Promise.all(
        batch.map(async (candidate) => await this.#toRecord(provider, owner, chainId, candidate)),
      )

      active.push(...checked.filter((record) => record !== null))
    }

    return active
  }

  /**
   * Turns a found grant into a record if it is still live.
   *
   * A contract reject means "could not check", and the record is
   * dropped: showing an unchecked grant as live is the same as
   * inventing it.
   */
  async #toRecord(
    provider: IProvider,
    owner: Address,
    chainId: ChainId,
    candidate: ICandidate,
  ): Promise<IApprovalRecord | null> {
    try {
      if (candidate.standard === TOKEN_STANDARD.Erc20) {
        const amount = decodeUint(
          await provider.call({
            to: candidate.contract,
            data: encodeAllowance(ALLOWANCE_SELECTOR, owner, candidate.spender),
          }),
        )

        /* Zero means the allowance was revoked or spent:
           it must not be shown as live. */
        if (amount === 0n) {
          return null
        }

        const token = await this.#token(provider, chainId, candidate.contract)

        return {
          chainId,
          contract: candidate.contract,
          spender: candidate.spender,
          standard: TOKEN_STANDARD.Erc20,
          amount,
          isUnlimited: amount >= UNLIMITED_THRESHOLD,
          symbol: token.symbol,
          decimals: token.decimals,
        }
      }

      const isApproved = decodeBool(
        await provider.call({
          to: candidate.contract,
          data: encodeAllowance(IS_APPROVED_FOR_ALL_SELECTOR, owner, candidate.spender),
        }),
      )

      if (!isApproved) {
        return null
      }

      const token = await this.#token(provider, chainId, candidate.contract)

      return {
        chainId,
        contract: candidate.contract,
        spender: candidate.spender,
        standard: TOKEN_STANDARD.Erc721,
        /* A collection allowance has no amount: every item can be
           spent, including those not yet held. */
        amount: null,
        isUnlimited: true,
        symbol: token.symbol,
        decimals: null,
      }
    } catch (error) {
      this.#logger.debug('The approval could not be verified', {
        reason: error instanceof Error ? error.message : String(error),
      })

      return null
    }
  }

  #token(
    provider: IProvider,
    chainId: ChainId,
    contract: Address,
  ): Promise<{ symbol: string | null; decimals: number | null }> {
    const key = `${chainId.toString()}:${contract.toLowerCase()}`
    const cached = this.#tokens.get(key)

    if (cached !== undefined) {
      return cached
    }

    const pending = Promise.all([
      readText(provider, contract, SYMBOL_SELECTOR),
      readDecimals(provider, contract),
    ]).then(([symbol, decimals]) => ({ symbol, decimals }))

    this.#tokens.set(key, pending)

    return pending
  }
}

/**
 * Collects grants from the logs, keeping one per pair
 * "contract + spender".
 *
 * THE LAST GRANT CANCELS THE PREVIOUS ONES: the allowance is
 * overwritten, not added. The live value is still read from the
 * contract, so the only thing that matters here is not checking
 * the same pair twice.
 *
 * AN `Approval` EVENT WITH FOUR TOPICS IS ERC-721: the item id
 * is indexed too. A single-item allowance vanishes on the first
 * transfer and is not needed in the list; including it would
 * show the owner long-stale records.
 */
function collectCandidates(logs: readonly ILogEntry[]): readonly ICandidate[] {
  const seen = new Map<string, ICandidate>()

  for (const log of logs) {
    const topic = log.topics[0]
    const spenderTopic = log.topics[2]

    if (spenderTopic === undefined) {
      continue
    }

    const standard =
      topic === APPROVAL_TOPIC && log.topics.length === ERC20_APPROVAL_TOPIC_COUNT
        ? TOKEN_STANDARD.Erc20
        : topic === APPROVAL_FOR_ALL_TOPIC
          ? TOKEN_STANDARD.Erc721
          : null

    if (standard === null) {
      continue
    }

    let spender: Address

    try {
      spender = topicToAddress(spenderTopic)
    } catch {
      continue
    }

    const key = `${log.address.toLowerCase()}:${spender.toLowerCase()}:${standard}`

    if (!seen.has(key)) {
      seen.set(key, { contract: log.address, spender, standard })
    }
  }

  return [...seen.values()]
}

/**
 * Reads a string field of the contract.
 *
 * `null` instead of an invented value: the symbol is optional, and
 * putting "Unknown token" here would claim the contract answered so.
 */
async function readText(
  provider: IProvider,
  contract: Address,
  selector: string,
): Promise<string | null> {
  try {
    return decodeString(await provider.call({ to: contract, data: encodeCall(selector) }))
  } catch {
    return null
  }
}

/**
 * Reads the decimal count.
 *
 * `null` means "unknown": showing an allowance of 1000000 units
 * as "1 000 000 tokens" when there are six decimals is an error
 * of six orders of magnitude in a question where the size of
 * the risk matters.
 */
async function readDecimals(provider: IProvider, contract: Address): Promise<number | null> {
  try {
    return Number(
      decodeUint(await provider.call({ to: contract, data: encodeCall(DECIMALS_SELECTOR) })),
    )
  } catch {
    return null
  }
}
